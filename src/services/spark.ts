/**
 * Spark 造数据脚本生成与验证（V0.22+）。
 * 服务器生命周期已拆到 sparkLifecycle.ts，本文件专注：
 *  提示词构造 / 代码提取 / Python 运行验证 / 保存。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { normalizePath } from '../utils/paths';
import { resolveLocalEndpoint } from '../utils/wsl';
import {
  cfg,
  getEndpoint,
  getModelName,
  llamaApiBase,
  probeSparkServer,
  ensureSparkServer,
  scheduleSparkStop,
  stopSparkServer,
  DEFAULT_MAX_TOKENS,
  DEFAULT_REQUEST_TIMEOUT_MS
} from './sparkLifecycle';

// 兼容旧入口：服务器停止能力仍从 spark 模块暴露。
export { stopSparkServer } from './sparkLifecycle';

const DEFAULT_SCRIPT_PATH = '';
const MAX_REPAIR_ATTEMPTS = 3;
const REPAIR_DELAY_MS = 500;
const MAX_SCRIPT_STDOUT_BYTES = 8 * 1024 * 1024;

function getScriptPath(): string {
  return normalizePath(cfg('sparkScriptPath', DEFAULT_SCRIPT_PATH));
}

/** 如果生成的脚本只定义了函数但没调用，尝试补一个入口再验证。 */
function tryCallGeneratorFunctions(code: string): string | null {
  if (/\bif\s+__name__\s*==\s*["']__main__["']/.test(code)) return null;
  const candidates = ['main', 'generate_test_data', 'generate_data', 'gen', 'solve'];
  for (const name of candidates) {
    const defRe = new RegExp(`^\\s*def\\s+${name}\\s*\\(`, 'm');
    if (defRe.test(code) && !code.includes(`${name}()`)) {
      return `${code}\n\nif __name__ == "__main__":\n    ${name}()\n`;
    }
  }
  return null;
}

/** 中文散文/解释行：不是代码，也不是 # 注释。用于把模型夹带的分析文字从代码尾部切掉。 */
function isProseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith('#')) return false;
  if (/^\s*(?:import|from|def|class|if|for|while|try|except|print|return|sys|random|data)\b/.test(t)) return false;
  if (/^\s*(?:@|[A-Za-z_]\w*\s*\(|=|\()/.test(t)) return false;
  return /[\u4e00-\u9fff]/.test(t);
}

/** 从模型输出中提取 Python 代码（兼容 markdown 代码块和纯文本）。
 *  小模型常不写 ```python 标记，因此做“暴力降级”：找到第一行像 Python 代码的行，
 *  丢弃前面可能出现的解释性文字，并切除代码尾部夹带的散文说明。 */
export function extractPythonCode(raw: string): string {
  const text = String(raw || '');
  const fence = /```(?:python|py)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) {
    const code = fence[1].trim();
    if (code) return code;
  }
  const lines = text.split('\n');
  const codeStart = /^\s*(?:import\s|from\s|def\s|class\s|@|#|if\s+__name__|print\s*\(|for\s|while\s|try\s*:|sys\.|data\s*=|random\.|[A-Za-z_]\w*\s*=)/;
  const start = lines.findIndex((l) => codeStart.test(l));
  if (start < 0) return '';
  const candidate = lines.slice(start);
  const proseAt = candidate.findIndex((l) => isProseLine(l));
  const codeLines = proseAt >= 0 ? candidate.slice(0, proseAt) : candidate;
  return codeLines.join('\n').trim();
}

/** 只从 reasoning_content 中提取明确包裹的代码块，避免把解题分析当成脚本保存。 */
function extractFencedPythonCode(raw: string): string {
  const fence = /```(?:python|py)?\s*([\s\S]*?)```/i.exec(String(raw || ''));
  return fence ? fence[1].trim() : '';
}

function pythonCommand(): string {
  const candidates = process.platform === 'win32' ? ['python'] : ['python3', 'python'];
  for (const c of candidates) {
    try {
      // 这里不实际执行 --version，避免每次都因杀毒/慢启动拖慢生成流程；
      // 直接交给后续 spawn 运行，失败时能给出明确错误。
      return c;
    } catch {
      /* 继续 */
    }
  }
  return candidates[0];
}

function runPythonCode(code: string, timeoutMs = 15000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), 'acm-workflow-spark', `gen_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.py`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, code, 'utf8');
    const cleanup = () => {
      try { fs.unlinkSync(tmp); } catch { /* 已清理 */ }
    };
    const cmd = pythonCommand();
    const child = spawn(cmd, [tmp], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let capped = false;
    const finish = (r: { ok: boolean; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(r);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ ok: false, stdout, stderr: stderr || '生成脚本运行超时（>15s）' });
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (!capped && Buffer.byteLength(stdout, 'utf8') > MAX_SCRIPT_STDOUT_BYTES) {
        capped = true;
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (e) => {
      finish({ ok: false, stdout, stderr: `无法运行 Python：${e.message}` });
    });
    child.on('close', (code) => {
      if (capped) {
        finish({ ok: false, stdout: stdout.slice(0, 200), stderr: '生成脚本输出超过 8MB，为防止前端卡死已终止' });
        return;
      }
      finish({ ok: code === 0 && stdout.trim().length > 0, stdout, stderr });
    });
  });
}

export interface SparkProblemContext {
  title: string;
  id?: string;
  url?: string;
  statement?: string;
  samples?: { input: string; output?: string }[];
  /** 可选：题目目录下的生成脚本保存路径（留空则用配置项或默认 ~/.acm-workflow/gen.py）。 */
  scriptPath?: string;
}

export function buildDataGenPrompt(problem: SparkProblemContext): string {
  const sampleBlock = (problem.samples || []).length > 0
    ? [
        '',
        '===== 样例格式（只作格式与数据范围参照，不要照抄数值） =====',
        ...(problem.samples || []).slice(0, 3).flatMap((s, i) => [
          `样例 ${i + 1} 输入：`,
          s.input.trim().slice(0, 500),
          s.output ? `样例 ${i + 1} 输出：${s.output.trim().slice(0, 200)}` : ''
        ]),
        '===== 样例结束 ====='
      ].join('\n')
    : '';

  return [
    '你是一名算法竞赛造数据专家。请根据下面的题目描述，编写一个 Python 3 脚本。',
    '脚本的任务：每次运行都输出一组**符合题面所有约束**的合法输入数据到 stdout。',
    '',
    '【输出格式硬约束 —— 放在最前面】',
    '1. 回复的第一行必须是 import、from、def 或 print(...) 之一，禁止先写解释、思考或 Markdown。',
    '2. 不要输出 ``` 代码块标记。',
    '3. 脚本可以定义函数，但必须在文件末尾调用它；运行 `python gen.py` 后 stdout 必须有数据。',
    '4. 如果复杂格式暂时无法处理，至少输出一个最小的合法数据骨架（例如一行整数），绝不能无输出。',
    '',
    '硬性要求：',
    '1. 只使用 Python 标准库（random、string 等），不要依赖第三方库。',
    '2. 必须严格满足题面给出的输入格式、数据范围、特殊约束。',
    '3. 输出只包含题目要求的输入数据，不要输出解释、提示或多余字符。',
    '4. 代码必须是完整可执行的 Python 脚本，不需要 Markdown 代码块。',
    '5. 如果题目有变量间依赖（如 n 和后面数组长度），请保证生成数据自洽。',
    '6. 在覆盖边界/特殊情况的前提下，生成的数据要尽可能多样化。',
    '7. 脚本不得使用 input() 或等待交互；必须一次性直接输出到 stdout。',
    '8. 生成数据规模必须符合题面约束；题面如果限制 N<=1e5，就不要生成 1e6 以上规模。',
    '9. 脚本本身应快速运行，不要做重计算或死循环。',
    `题目：${problem.title || ''}${problem.id ? ` (${problem.id})` : ''}`,
    problem.url ? `链接：${problem.url}` : '',
    '',
    '===== 题面开始 =====',
    problem.statement || '',
    '===== 题面结束 =====',
    sampleBlock,
    '',
    '【结尾再次提醒】',
    '请只输出 Python 代码本身，不要带 Markdown 代码块，不要解释。',
    '再次强调：脚本运行后必须向 stdout 输出数据；如果定义了函数，必须在文件末尾调用它。',
    '如果实在无法生成复杂数据，请输出一个最小合法骨架（例如 print(1)），绝不能无输出。',
    '只输出代码，直接以 import/from/def/print 开头。'
  ].join('\n');
}

/** 构造“修正提示词”：把上一版脚本 + 运行错误喂回模型，让它做小步修正。 */
function buildRepairPrompt(problem: SparkProblemContext | undefined, code: string, check: { stdout: string; stderr: string }): string {
  const errorDetail = check.stderr.trim()
    || (check.stdout.trim() ? '脚本没有输出任何数据（可能只定义了函数但没有调用）' : '脚本没有输出任何数据');
  return [
    '你之前生成的 Python 造数据脚本没有通过本地验证。',
    '请根据下面的错误信息修正脚本，只输出修正后的完整 Python 3 代码。',
    '',
    '【输出格式硬约束】',
    '1. 回复第一行必须是 import、from、def 或 print(...) 之一，禁止解释和 Markdown。',
    '2. 脚本运行后 stdout 必须有数据；如果定义了函数，必须在文件末尾调用它。',
    '3. 如果不知道如何完整修正，请直接输出一个最小合法数据骨架（例如 print(1)），绝不能无输出。',
    '',
    `题目：${problem?.title || ''}${problem?.id ? ` (${problem.id})` : ''}`,
    problem?.url ? `链接：${problem.url}` : '',
    '',
    '===== 题面开始（必须重新满足这些约束） =====',
    problem?.statement || '',
    '===== 题面结束 =====',
    '',
    '===== 上一版脚本 =====',
    code.slice(0, 6000),
    '===== 验证结果 =====',
    errorDetail.slice(0, 2000),
    '',
    problem && problem.samples && problem.samples.length > 0
      ? [
          '===== 样例格式（只作格式参照） =====',
          ...problem.samples.slice(0, 2).map((s, i) => `样例 ${i + 1} 输入：\n${s.input.trim().slice(0, 500)}`),
          '===== 样例结束 ====='
        ].join('\n')
      : '',
    '',
    '请只输出修正后的完整 Python 代码，不要 Markdown、不要解释。'
  ].join('\n');
}

const PROSE_MARKERS = /(说明|解析|思路|答案|解释|总结|注意|样例|输出|复杂度)/;

/** 轻量形状校验：输出不能夹带解释性文字；若样例首行是一个整数 N，则生成输出首行也应是整数。 */
function outputLooksLikeData(output: string, samples?: { input: string; output?: string }[]): boolean {
  const text = String(output || '').trim();
  if (!text) return false;
  const lines = text.split('\n');
  if (lines.some((l) => PROSE_MARKERS.test(l) && !l.trim().startsWith('#'))) return false;
  const first = lines[0]?.trim() || '';
  const sampleFirst = samples?.[0]?.input.trim().split('\n')[0]?.trim() || '';
  if (/^\d+$/.test(sampleFirst) && !/^-?\d+$/.test(first)) return false;
  return true;
}

/** 保底脚本：多次修正仍失败时写入，至少保证有 stdout，流程不卡死。 */
function buildFallbackScript(): string {
  return [
    'import random',
    '',
    'def gen():',
    '    # ACM Workflow 保底脚本：模型多次修正失败后写入，至少保证有输出。',
    '    print(1)',
    '',
    'if __name__ == "__main__":',
    '    gen()',
    ''
  ].join('\n');
}

function tokenExpressions(tokens: string[]): string[] {
  return tokens.map((t) => {
    if (/^-?\d+$/.test(t)) return 'random.randint(1, 10)';
    if (/^[A-Za-z]+$/.test(t)) {
      const len = Math.max(1, t.length);
      return `''.join(random.choice('abcdefghijklmnopqrstuvwxyz') for _ in range(${len}))`;
    }
    return `'${t.replace(/'/g, "\\'")}'`;
  });
}

function splitTokens(line: string): string[] {
  return line.split(/\s+/).filter(Boolean);
}

/** 从题面文本中截取“输入格式”小节；找不到返回空串。 */
function extractInputSection(text: string): string {
  const md = /(?:^|\n)##?\s*(?:输入格式|输入)\s*\n([\s\S]*?)(?=\n##?\s*(?:输出格式|输出)|$)/i.exec(text);
  if (md?.[1]?.trim()) return md[1].trim();
  const plain = /(?:^|\n)\s*(?:Input|输入格式)\s*[:：]?\s*\n?([\s\S]*?)(?=\n\s*(?:Output|输出格式))/i.exec(text);
  return plain?.[1]?.trim() || '';
}

/** 展开 “10^5” / “2×10^5” / “-10^9” 这类约束写法。 */
function parseConstraintNumber(s: string): number | null {
  const raw = s.trim();
  const sign = raw.startsWith('-') ? -1 : 1;
  const core = raw.replace(/^-/, '');
  const m1 = /(\d+(?:\.\d+)?)\s*×\s*10\^(\d+)/i.exec(core);
  if (m1) return sign * Number(m1[1]) * Math.pow(10, Number(m1[2]));
  const m2 = /10\^(\d+)/i.exec(core);
  if (m2) return sign * Math.pow(10, Number(m2[1]));
  const n = Number(core.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? sign * n : null;
}

/** 从输入格式文本中推断变量名的大致范围；缺省 1..10。 */
function inferVarRange(text: string, varName: string): [number, number] {
  const patterns = [
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:≤|<=|<)\\s*${varName}\\s*(?:≤|<=|<)\\s*(\\d+(?:\\.\\d+)?)`, 'i'),
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:≤|<=|<)\\s*${varName}`, 'i'),
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:≥|>=|>)\\s*${varName}`, 'i')
  ];
  let lo = 1;
  let hi = 10;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const a = parseConstraintNumber(m[1]);
      const b = m[2] ? parseConstraintNumber(m[2]) : null;
      if (a !== null && b !== null) return [a, b];
      if (a !== null) {
        if (re.source.includes('≥') || re.source.includes('>')) lo = a; else hi = a;
      }
    }
  }
  return [lo, hi];
}

/** 只返回文本中明确出现的变量范围；找不到返回 null，不强行给默认值。 */
function tryInferVarRange(text: string, varName: string): [number, number] | null {
  const num = '(-?\\d+(?:\\.\\d+)?(?:×10\\^\\d+)?)';
  const full = new RegExp(`${num}\\s*(?:≤|<=|<)\\s*${varName}\\s*(?:≤|<=|<)\\s*${num}`, 'i');
  const m = full.exec(text);
  if (m) {
    const a = parseConstraintNumber(m[1]);
    const b = parseConstraintNumber(m[2]);
    if (a !== null && b !== null) return [Math.min(a, b), Math.max(a, b)];
  }
  const upper = new RegExp(`${varName}\\s*(?:≤|<=|<)\\s*${num}`, 'i');
  const mu = upper.exec(text);
  if (mu) {
    const hi = parseConstraintNumber(mu[1]);
    if (hi !== null) return [1, hi];
  }
  const lower = new RegExp(`${varName}\\s*(?:≥|>=|>)\\s*${num}`, 'i');
  const ml = lower.exec(text);
  if (ml) {
    const lo = parseConstraintNumber(ml[1]);
    if (lo !== null) return [lo, 10];
  }
  return null;
}

/**
 * 优先按题面「输入格式」小节生成：理解变量（n/m）、依赖（数组长度、行数）与约束范围。
 * 这是规则解析，不是 LLM；解析不了时返回 null，由样例形状路径兜底。
 */
export function buildInputFormatScript(statement: string): string | null {
  const section = extractInputSection(statement);
  if (!section) return null;
  const text = section.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const twoVars = /第一行[^\n]{0,80}?\b([nN])\b[^\n]{0,80}?\b([mM])\b/.exec(text) ||
                  /^[^\n]{0,40}?([nN])\s*[,，和\s]+([mM])/.exec(text);
  const oneVar = /第一行[^\n]{0,80}?\b([nN])\b/.exec(text) || /\b([nN])\b/.exec(text);

  const hasArray = /([nN])\s*个(?:整数|正整数|数|元素)/.test(text) || /([nN])\s*个数/.test(text);
  const rowsM = /(?:接下来|随后|后面|之后)\s*([mM])\s*行|([mM])\s*行，每行/.exec(text) || /([mM])\s*行/.exec(text);
  const rowsN = /(?:接下来|随后|后面|之后)\s*([nN])\s*行|([nN])\s*行，每行/.exec(text) || /([nN])\s*行/.exec(text);

  // 元素范围：优先 a_i / x_i / u / v 等约束，找不到时使用常见的 1..1e9。
  const aRange = tryInferVarRange(text, 'a_i') || tryInferVarRange(text, 'a') || [1, 1000000000];
  const col1Range = tryInferVarRange(text, 'u') || tryInferVarRange(text, 'x_i') || tryInferVarRange(text, 'x') || [1, 1000000000];
  const col2Range = tryInferVarRange(text, 'v') || tryInferVarRange(text, 'y_i') || tryInferVarRange(text, 'y') || col1Range;

  if (twoVars) {
    const nVar = twoVars[1] || 'n';
    const mVar = twoVars[2] || 'm';
    const [nLo, nHi] = inferVarRange(text, nVar);
    const [mLo, mHi] = inferVarRange(text, mVar);
    const rowMatch = rowsM || rowsN;
    if (rowMatch) {
      const rowCountVar = rowMatch[1] || rowMatch[2] || 'm';
      const rowVar = rowCountVar.toLowerCase();
      return [
        'import random',
        '',
        `n = random.randint(${nLo}, ${nHi})`,
        `m = random.randint(${mLo}, ${mHi})`,
        'print(n, m)',
        `for _ in range(${rowVar}):`,
        `    print(random.randint(${col1Range[0]}, ${col1Range[1]}), random.randint(${col2Range[0]}, ${col2Range[1]}))`,
        ''
      ].join('\n');
    }
  }

  const nVar = (oneVar?.[1] || 'n').toLowerCase();
  const [nLo, nHi] = inferVarRange(text, nVar);
  if (hasArray) {
    return [
      'import random',
      '',
      `n = random.randint(${nLo}, ${nHi})`,
      'print(n)',
      `print(' '.join(str(random.randint(${aRange[0]}, ${aRange[1]})) for _ in range(n)))`,
      ''
    ].join('\n');
  }
  if (rowsN) {
    return [
      'import random',
      '',
      `n = random.randint(${nLo}, ${nHi})`,
      'print(n)',
      'for _ in range(n):',
      `    print(random.randint(${col1Range[0]}, ${col1Range[1]}), random.randint(${col2Range[0]}, ${col2Range[1]}))`,
      ''
    ].join('\n');
  }
  return null;
}

/** 只保留样例原始行数/token 结构的兜底：不推断变量依赖。 */
function buildLiteralShapeScript(lines: string[]): string {
  const out: string[] = ['import random', ''];
  for (const line of lines) {
    const tokens = splitTokens(line);
    if (tokens.length === 0) continue;
    out.push(`print(${tokenExpressions(tokens).join(', ')})`);
  }
  out.push('');
  return out.join('\n');
}

/** 推断“首行 N + 后面 N 行，每行 k 个 token”的矩阵/行结构。 */
function buildRowsScript(n: number, cols: number, sampleRows: string[]): string {
  const exprs = tokenExpressions(splitTokens(sampleRows[0] || ''));
  const out = [
    'import random',
    '',
    `n = ${n}`,
    'print(n)',
    'for _ in range(n):',
    `    print(${exprs.join(', ')})`,
    ''
  ];
  return out.join('\n');
}

/** 推断“首行 N + 下一行正好 N 个 token”的数组/序列结构。 */
function buildArrayScript(n: number, sampleLine: string): string {
  const exprs = tokenExpressions(splitTokens(sampleLine));
  return [
    'import random',
    '',
    `n = ${n}`,
    'print(n)',
    `print(${exprs.join(', ')})`,
    ''
  ].join('\n');
}

/**
 * 样例形状随机化生成器：先尝试理解样例形式的规律，再据此生成脚本。
 * 当前能识别的规律：
 *  - 首行单个整数 N，后续恰好 N 行且每行 token 数相同 → 矩阵/行结构
 *  - 首行单个整数 N，后续仅一行且 token 数 = N → 数组/序列结构
 * 无法识别时退化为“逐行保持 token 形状”。
 * 全程不依赖 LLM。
 */
export function buildSampleShapeFallbackScript(samples?: { input: string; output?: string }[]): string | null {
  const sample = samples?.[0]?.input;
  if (!sample || !sample.trim()) return null;
  const lines = sample.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const head = splitTokens(lines[0]);
  const headIsSingleInt = head.length === 1 && /^\d+$/.test(head[0]);
  const n = headIsSingleInt ? Number(head[0]) : null;
  const rest = lines.slice(1);

  if (n !== null && n > 0 && rest.length > 0) {
    const counts = rest.map((l) => splitTokens(l).length);
    // 规律：N 行，每行 token 数一致
    if (rest.length === n && counts.every((c) => c === counts[0]) && counts[0] > 0) {
      return buildRowsScript(n, counts[0], rest);
    }
    // 规律：仅 1 行，且该行 token 数 = N
    if (rest.length === 1) {
      const tokens = splitTokens(rest[0]);
      if (tokens.length === n) return buildArrayScript(n, rest[0]);
    }
  }

  return buildLiteralShapeScript(lines);
}

export class SparkService {
  async isRunning(): Promise<boolean> {
    return probeSparkServer();
  }

  async ensureReady(): Promise<boolean> {
    const ok = await ensureSparkServer();
    if (ok) scheduleSparkStop();
    return ok;
  }

  /** 根据题目上下文生成 Python 造数据脚本并返回代码。 */
  async generateScriptForProblem(problem: SparkProblemContext): Promise<string> {
    return this.generateScript(buildDataGenPrompt(problem));
  }

  /**
   * 轻量首选路径：不使用 LLM。
   * 优先按题面「输入格式」小节生成（理解变量/依赖/约束），解析不了再用样例形状。
   */
  fastGenerate(problem: SparkProblemContext): { code: string; mode: 'input' | 'sample' | 'minimal' } {
    const fromInput = buildInputFormatScript(problem.statement || '');
    if (fromInput) return { code: fromInput, mode: 'input' };
    const fromSample = buildSampleShapeFallbackScript(problem.samples);
    if (fromSample) return { code: fromSample, mode: 'sample' };
    return { code: buildFallbackScript(), mode: 'minimal' };
  }

  /** 调用 Spark 生成 Python 造数据脚本并返回代码。 */
  async generateScript(prompt: string): Promise<string> {
    if (!(await ensureSparkServer())) {
      throw new Error('Spark 本地模型启动失败，请检查 tools/start_spark.sh 或设置中的 Spark 路径。');
    }
    scheduleSparkStop();

    const target = resolveLocalEndpoint(getEndpoint());
    const timeoutMs = cfg('sparkRequestTimeoutMs', DEFAULT_REQUEST_TIMEOUT_MS);
    const payload = {
      model: getModelName(),
      messages: [
        { role: 'system', content: '你是一名算法竞赛数据生成器编写专家。唯一任务是编写生成随机合法输入数据的 Python 3 脚本；不要解题、不要解释算法、不要输出任何分析内容，只输出可运行的 Python 代码。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      top_p: 0.9,
      max_tokens: cfg('sparkMaxTokens', DEFAULT_MAX_TOKENS),
      stream: false
    };
    let res: Response;
    try {
      res = await fetch(llamaApiBase(target) + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (e?.name === 'AbortError' || /timeout|aborted/i.test(msg)) {
        throw new Error(`Spark 生成超时（超过 ${Math.round(timeoutMs / 1000)} 秒）。可调大 acmWorkflow.sparkRequestTimeoutMs，或检查模型速度/显存。`);
      }
      throw new Error(`Spark 请求异常：${msg}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Spark 生成请求失败 HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data: any = await res.json();
    const message = data?.choices?.[0]?.message || {};
    const content = String(message?.content || '');
    // Spark 带思维链时会先把内容放进 reasoning_content，content 反而为空。
    // 只从 reasoning 里提取明确 ```python 代码块，避免把解题分析/解释保存成脚本。
    const reasoning = String(message?.reasoning_content || '');
    // 先取正文；正文只有分析时再取 reasoning 的代码块；部分模型 reasoning 也不加围栏，最后再用暴力解析兜底。
    const code = extractPythonCode(content) || extractFencedPythonCode(reasoning) || extractPythonCode(reasoning);
    if (!code) {
      const detail = (content || reasoning).slice(0, 150);
      throw new Error(`Spark 没有返回可用的 Python 代码（可能把解题分析当成了脚本）${detail ? `：${detail}` : ''}`);
    }
    return code;
  }

  /** 验证并保存到固定脚本路径；验证失败时把错误回喂 Spark 做最多 3 次小步修正。
   *  仍失败则写入一个保底可运行脚本，避免工作流因“无输出”卡死。
   *  @param problem 题目上下文，用于修正提示词里的样例/题面。 */
  async validateAndSave(code: string, problem?: SparkProblemContext): Promise<{ path: string; code: string; stdout: string; stderr: string; fallback?: boolean }> {
    const evaluate = (c: { ok: boolean; stdout: string; stderr: string }) => {
      if (c.ok && !outputLooksLikeData(c.stdout, problem?.samples)) {
        return {
          ok: false,
          stdout: c.stdout,
          stderr: c.stderr || '输出疑似包含解释性文字，或与样例输入首行形状不符'
        };
      }
      return c;
    };

    let finalCode = code;
    let check = evaluate(await runPythonCode(finalCode));
    if (!check.ok && !check.stdout && !check.stderr) {
      const repaired = tryCallGeneratorFunctions(finalCode);
      if (repaired) {
        const check2 = evaluate(await runPythonCode(repaired));
        if (check2.ok) {
          finalCode = repaired;
          check = check2;
        }
      }
    }

    // 小模型“草稿-执行-报错-修正”闭环：把错误回喂，允许模型自行修复。
    for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS && !check.ok; attempt++) {
      console.warn(`[ACM-Workflow][Spark] 第 ${attempt}/${MAX_REPAIR_ATTEMPTS} 次修正：${check.stderr.trim().slice(0, 300) || '无输出'}`);
      await new Promise((r) => setTimeout(r, REPAIR_DELAY_MS));
      const fixed = await this.generateScript(buildRepairPrompt(problem, finalCode, check)).catch(() => null);
      if (!fixed) break;
      finalCode = fixed;
      check = evaluate(await runPythonCode(finalCode));
      // 修正稿也可能只定义函数未调用，自动补入口。
      if (!check.ok && !check.stdout && !check.stderr) {
        const repaired = tryCallGeneratorFunctions(finalCode);
        if (repaired) {
          const check2 = evaluate(await runPythonCode(repaired));
          if (check2.ok) {
            finalCode = repaired;
            check = check2;
          }
        }
      }
    }

    let fallback = false;
    if (!check.ok) {
      console.warn('[ACM-Workflow][Spark] 多次修正仍失败，写入保底可运行脚本');
      // 优先用“样例形状随机化”，比 print(1) 更有用；没有样例时退回最小骨架。
      finalCode = buildSampleShapeFallbackScript(problem?.samples) || buildFallbackScript();
      check = evaluate(await runPythonCode(finalCode));
      fallback = true;
      if (!check.ok) {
        throw new Error(`生成的脚本验证失败：${check.stderr || '无输出'}`);
      }
    }

    // 保存优先级：调用方指定的题目目录 gen.py > sparkScriptPath 配置 > ~/.acm-workflow/gen.py。
    const configured = getScriptPath();
    const target = problem?.scriptPath || configured || path.join(os.homedir(), '.acm-workflow', 'gen.py');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // 原子写入：先写临时文件再 rename，避免生成中断留下半个 gen.py。
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(tmp, finalCode, 'utf8');
      fs.renameSync(tmp, target);
    } finally {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* 已清理 */ }
    }
    scheduleSparkStop();
    return {
      path: target,
      code: finalCode,
      stdout: check.stdout.slice(0, 200),
      stderr: check.stderr,
      fallback
    };
  }

  /** 暴露给 SupportService/扩展退出时调用。 */
  dispose(): void {
    stopSparkServer();
  }
}
