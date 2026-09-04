import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import { findCompiler } from './runner';

const execFileAsync = promisify(execFile);

/**
 * 造数据机器（模块三）：内置数组/树/图/字符串/排列生成器 + 用户脚本自定义。
 * 生成器全部为纯函数（可注入种子，单测确定性）；脚本生成走子进程。
 */

// ===== 可复现随机数（mulberry32）=====

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newRng(): Rng {
  return mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
}

/** [min, max] 闭区间随机整数 */
function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** 洗牌（原地） */
function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===== 生成规格 =====

export type DataGenType = 'array' | 'tree' | 'graph' | 'string' | 'permutation' | 'script' | 'pipeline' | 'int' | 'line' | 'ints' | 'text' | 'newline' | 'pairs' | 'repeat';

/** 流水线中的单个生成步骤；repeat 可通过 steps 嵌套一个子流水线 */
export type DataGenStepSpec = Omit<DataGenSpec, 'type'> & { type: Exclude<DataGenType, 'pipeline'> };

export interface DataGenSpec {
  type: DataGenType;
  /** 组合流水线/重复块：按顺序生成并拼接多段数据 */
  steps?: DataGenStepSpec[];
  // array / permutation / ints / pairs / repeat
  nMin?: number;
  nMax?: number;
  // array / int / ints / pairs
  vMin?: number;
  vMax?: number;
  sorted?: 'none' | 'asc' | 'desc';
  // tree / pairs
  weighted?: boolean;
  wMin?: number;
  wMax?: number;
  // graph
  mMin?: number;
  mMax?: number;
  directed?: boolean;
  // string
  lenMin?: number;
  lenMax?: number;
  charset?: string; // 'lower' | 'upper' | 'digit' | 'lowerdigit' | 自定义字符集
  // script
  scriptPath?: string;
  // ints / text / repeat
  sep?: string;
  text?: string;
  newline?: boolean;
  // 变量绑定（int 步骤可命名，供后续 repeat 引用）
  varName?: string;
  // repeat：固定次数 / 引用变量 / 随机范围
  count?: number;
  countRef?: string;
  countMin?: number;
  countMax?: number;
}

// ===== 内置生成器 =====

function clampInt(v: number | undefined, def: number, min: number, max: number): number {
  const n = Number.isFinite(v) ? Math.round(v as number) : def;
  return Math.min(max, Math.max(min, n));
}

function genArray(spec: DataGenSpec, rng: Rng): string {
  const n = randInt(rng, clampInt(spec.nMin, 10, 1, 1000000), clampInt(spec.nMax, 10, 1, 1000000));
  const vMin = clampInt(spec.vMin, 1, -1e9, 1e9);
  const vMax = clampInt(spec.vMax, 1e9, -1e9, 1e9);
  const lo = Math.min(vMin, vMax);
  const hi = Math.max(vMin, vMax);
  const arr = Array.from({ length: n }, () => randInt(rng, lo, hi));
  if (spec.sorted === 'asc') arr.sort((a, b) => a - b);
  if (spec.sorted === 'desc') arr.sort((a, b) => b - a);
  return `${n}\n${arr.join(' ')}\n`;
}

function genTree(spec: DataGenSpec, rng: Rng): string {
  const n = clampInt(spec.nMin ?? spec.nMax, 10, 1, 1000000);
  const wMin = clampInt(spec.wMin, 1, -1e9, 1e9);
  const wMax = clampInt(spec.wMax, 1e9, -1e9, 1e9);
  const lo = Math.min(wMin, wMax);
  const hi = Math.max(wMin, wMax);
  const lines: string[] = [String(n)];
  for (let i = 2; i <= n; i++) {
    const p = randInt(rng, 1, i - 1);
    if (spec.weighted) {
      lines.push(`${p} ${i} ${randInt(rng, lo, hi)}`);
    } else {
      lines.push(`${p} ${i}`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * 简单图的边用全局编号（0..totalEdges-1）表示，避免 n 较大时构造 O(n²) 全边数组。
 * 无向边按行优先编号：(u,v), u<v；有向边按行优先编号：u!=v。
 */
function undirectedStartRow(n: number, u: number): number {
  return (u - 1) * n - ((u - 1) * u) / 2;
}

function edgeFromIndex(n: number, directed: boolean, k: number): [number, number] {
  if (directed) {
    const row = Math.floor(k / (n - 1));
    const local = k - row * (n - 1);
    const u = row + 1;
    const v = local < u - 1 ? local + 1 : local + 2;
    return [u, v];
  }
  // 无向：找第 k 条边所在的行（第 u 行有 n-u 条边），二分避免逐行扫描。
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (undirectedStartRow(n, mid) <= k) lo = mid; else hi = mid - 1;
  }
  const u = lo;
  const v = u + (k - undirectedStartRow(n, u)) + 1;
  return [u, v];
}

/** Floyd 随机抽样：从 [0, N) 中无放回取 m 个不同编号，O(m) 时间与内存。 */
function sampleDistinct(rng: Rng, m: number, n: number): number[] {
  const picked = new Set<number>();
  for (let i = n - m; i < n; i++) {
    const t = randInt(rng, 0, i);
    if (picked.has(t)) picked.add(i); else picked.add(t);
  }
  return Array.from(picked);
}

function genGraph(spec: DataGenSpec, rng: Rng): string {
  const n = clampInt(spec.nMin ?? spec.nMax, 8, 1, 100000);
  const directed = !!spec.directed;
  const maxEdges = directed ? n * (n - 1) : Math.floor((n * (n - 1)) / 2);
  let m = randInt(rng, clampInt(spec.mMin, n - 1, 0, maxEdges), clampInt(spec.mMax, Math.min(maxEdges, n + 5), 0, maxEdges));
  m = Math.min(m, maxEdges);

  const wMin = clampInt(spec.wMin, 1, -1e9, 1e9);
  const wMax = clampInt(spec.wMax, 1e9, -1e9, 1e9);
  const lo = Math.min(wMin, wMax);
  const hi = Math.max(wMin, wMax);

  // 简单图随机不重复边：直接对全局边编号做无放回抽样，不构造全边数组。
  const indexes = sampleDistinct(rng, m, maxEdges);
  const lines: string[] = [`${n} ${m}`];
  for (const k of indexes) {
    const [u, v] = edgeFromIndex(n, directed, k);
    lines.push(spec.weighted ? `${u} ${v} ${randInt(rng, lo, hi)}` : `${u} ${v}`);
  }
  return lines.join('\n') + '\n';
}

const CHARSETS: Record<string, string> = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digit: '0123456789',
  lowerdigit: 'abcdefghijklmnopqrstuvwxyz0123456789',
  lowerupper: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
};

function genString(spec: DataGenSpec, rng: Rng): string {
  const len = randInt(rng, clampInt(spec.lenMin, 10, 0, 1000000), clampInt(spec.lenMax, 10, 0, 1000000));
  const pool = CHARSETS[spec.charset || 'lower'] || String(spec.charset || 'ab') || 'ab';
  const chars = new Array<string>(len);
  for (let i = 0; i < len; i++) {
    chars[i] = pool[randInt(rng, 0, pool.length - 1)];
  }
  return chars.join('') + '\n';
}

function genPermutation(spec: DataGenSpec, rng: Rng): string {
  const n = randInt(rng, clampInt(spec.nMin, 10, 1, 1000000), clampInt(spec.nMax, 10, 1, 1000000));
  const p = shuffle(rng, Array.from({ length: n }, (_, i) => i + 1));
  return `${n}\n${p.join(' ')}\n`;
}

/** 原语：单行单数，始终独占一行（傻瓜式，不用管换行） */
function genLine(spec: DataGenSpec, rng: Rng): string {
  const vMin = clampInt(spec.vMin, 1, -1e9, 1e9);
  const vMax = clampInt(spec.vMax, 1e9, -1e9, 1e9);
  const lo = Math.min(vMin, vMax);
  const hi = Math.max(vMin, vMax);
  return `${randInt(rng, lo, hi)}\n`;
}

/** 细粒度原语：单个数，默认不加换行；勾选 newline 才换行（进阶用） */
function genInt(spec: DataGenSpec, rng: Rng): string {
  const vMin = clampInt(spec.vMin, 1, -1e9, 1e9);
  const vMax = clampInt(spec.vMax, 1e9, -1e9, 1e9);
  const lo = Math.min(vMin, vMax);
  const hi = Math.max(vMin, vMax);
  let out = String(randInt(rng, lo, hi));
  if (spec.newline) out += '\n';
  return out;
}

/** 数量解析：优先 countRef（引用前面单数行的变量），其次固定 count，最后随机范围 */
function resolveCount(spec: DataGenSpec, ctx: Record<string, any>, rng: Rng): number {
  if (spec.countRef) {
    const v = Number(ctx[spec.countRef]);
    if (!Number.isFinite(v)) {
      throw new Error(`数量引用了不存在的变量：${spec.countRef}`);
    }
    return Math.max(0, Math.round(v));
  }
  if (Number.isFinite(spec.count)) {
    return Math.max(0, Math.round(spec.count || 0));
  }
  return randInt(rng, clampInt(spec.nMin, 5, 1, 1000000), clampInt(spec.nMax, 5, 1, 1000000));
}

/** 细粒度原语：一行多个数，可自定义分隔符，默认末尾换行 */
function genInts(spec: DataGenSpec, rng: Rng, ctx: Record<string, any> = {}): string {
  const n = resolveCount(spec, ctx, rng);
  const vMin = clampInt(spec.vMin, 1, -1e9, 1e9);
  const vMax = clampInt(spec.vMax, 1e9, -1e9, 1e9);
  const lo = Math.min(vMin, vMax);
  const hi = Math.max(vMin, vMax);
  const arr = Array.from({ length: n }, () => randInt(rng, lo, hi));
  let out = arr.join(spec.sep ?? ' ');
  if (spec.newline !== false) out += '\n';
  return out;
}

/** 细粒度原语：N 行，每行两个整数（如龙/边等成对数据） */
function genPairs(spec: DataGenSpec, rng: Rng, ctx: Record<string, any> = {}): string {
  const n = resolveCount(spec, ctx, rng);
  const xMin = clampInt(spec.vMin, 1, -1e18, 1e18);
  const xMax = clampInt(spec.vMax, 1e12, -1e18, 1e18);
  const yMin = clampInt(spec.wMin, 1, -1e18, 1e18);
  const yMax = clampInt(spec.wMax, 1e18, -1e18, 1e18);
  const xlo = Math.min(xMin, xMax);
  const xhi = Math.max(xMin, xMax);
  const ylo = Math.min(yMin, yMax);
  const yhi = Math.max(yMin, yMax);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    lines.push(`${randInt(rng, xlo, xhi)} ${randInt(rng, ylo, yhi)}`);
  }
  return lines.join('\n') + '\n';
}

/** 细粒度原语：固定文本，原样输出（可含换行） */
function genText(spec: DataGenSpec): string {
  return spec.text ?? '';
}

/** 细粒度原语：一个换行 */
function genNewline(): string {
  return '\n';
}

// ===== 脚本生成器 =====

const SCRIPT_RUN_TIMEOUT_MS = 15000;

let cachedPythonCommand: string | null = null;

/** WSL/Linux 通常只有 python3；Windows 通常用 python；找不到 python3 时回退 python */
function pythonCommand(): string {
  if (cachedPythonCommand) return cachedPythonCommand;
  const candidates = process.platform === 'win32' ? ['python'] : ['python3', 'python'];
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore', windowsHide: true });
      cachedPythonCommand = c;
      return c;
    } catch {
      /* try next */
    }
  }
  cachedPythonCommand = candidates[0];
  return cachedPythonCommand;
}

async function runScript(scriptPath: string): Promise<string> {
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    throw new Error(`生成脚本不存在：${scriptPath || '(未填写)'}`);
  }
  const ext = path.extname(scriptPath).toLowerCase();
  let cmd: string;
  let args: string[];

  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    cmd = process.execPath; // 用扩展宿主自己的 Node
    args = [scriptPath];
  } else if (ext === '.py') {
    cmd = pythonCommand();
    args = [scriptPath];
  } else if (ext === '.cpp' || ext === '.cc') {
    const compiler = findCompiler();
    if (!compiler) throw new Error('需要 g++ 编译 .cpp 生成脚本，未找到编译器');
    const exe = path.join(os.tmpdir(), 'acm-workflow', 'gen_' + Date.now() + (process.platform === 'win32' ? '.exe' : ''));
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    try {
      await execFileAsync(compiler, ['-O2', '-std=c++17', scriptPath, '-o', exe], {
        encoding: 'utf8', timeout: 60000, windowsHide: true
      });
    } catch (e: any) {
      throw new Error(`生成脚本编译失败：${String(e?.stderr || e?.message).slice(0, 400)}`);
    }
    cmd = exe;
    args = [];
  } else {
    throw new Error(`不支持的生成脚本类型：${ext}（支持 .js / .py / .cpp）`);
  }

  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cleanup = () => {
      if ((ext === '.cpp' || ext === '.cc') && cmd) {
        try { fs.unlinkSync(cmd); } catch { /* 已清理 */ }
      }
    };
    const finish = (err?: Error, out?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (err) reject(err); else resolve(out!);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish(new Error('生成脚本运行超时（>15s）'));
    }, SCRIPT_RUN_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => {
      finish(new Error(`生成脚本无法运行：${e.message}`));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(`生成脚本退出码 ${code}：${stderr.slice(0, 400)}`));
        return;
      }
      if (!stdout.trim()) {
        finish(new Error('生成脚本没有输出任何数据'));
        return;
      }
      finish(undefined, stdout);
    });
  });
}

// ===== 统一入口 =====

/** 按规格生成一组随机数据（作为程序 stdin 的文本） */
export async function generateInput(
  spec: DataGenSpec,
  rng?: Rng,
  ctx: Record<string, any> = {}
): Promise<string> {
  const r = rng || newRng();

  // 组合流水线：按顺序精确拼接（是否换行由每个步骤自己控制）
  if (spec.type === 'pipeline') {
    const steps = Array.isArray(spec.steps) ? spec.steps : [];
    if (steps.length === 0) {
      throw new Error('组合流水线至少需要一个生成步骤');
    }
    const parts: string[] = [];
    for (const step of steps) {
      const out = await generateInput(step, r, ctx);
      if (step.varName) {
        // 单行单数/单个数存数字，其他存原始输出，供 countRef 使用
        ctx[step.varName] = (step.type === 'int' || step.type === 'line') ? Number(out.trim()) : out;
      }
      parts.push(out);
    }
    return parts.join('');
  }

  // 重复块：按固定次数 / 变量引用 / 随机范围，重复执行子流水线
  if (spec.type === 'repeat') {
    let count: number;
    if (spec.countRef) {
      const v = Number(ctx[spec.countRef]);
      if (!Number.isFinite(v)) {
        throw new Error(`重复次数引用了不存在的变量：${spec.countRef}`);
      }
      count = Math.max(0, Math.round(v));
    } else if (Number.isFinite(spec.count)) {
      count = Math.max(0, Math.round(spec.count || 0));
    } else {
      count = randInt(r, clampInt(spec.countMin, 1, 0, 1000000), clampInt(spec.countMax, 1, 0, 1000000));
    }
    const bodySteps = Array.isArray(spec.steps) ? spec.steps : [];
    if (bodySteps.length === 0) {
      throw new Error('重复块至少需要一个子步骤');
    }
    const body: DataGenSpec = { type: 'pipeline', steps: bodySteps };
    let out = '';
    for (let i = 0; i < count; i++) {
      out += await generateInput(body, r, ctx);
    }
    return out;
  }

  switch (spec.type) {
    case 'array': return genArray(spec, r);
    case 'tree': return genTree(spec, r);
    case 'graph': return genGraph(spec, r);
    case 'string': return genString(spec, r);
    case 'permutation': return genPermutation(spec, r);
    case 'int': return genInt(spec, r);
    case 'line': return genLine(spec, r);
    case 'ints': return genInts(spec, r, ctx);
    case 'pairs': return genPairs(spec, r, ctx);
    case 'text': return genText(spec);
    case 'newline': return genNewline();
    case 'script': return runScript(spec.scriptPath || '');
    default: throw new Error(`未知数据类型：${(spec as any).type}`);
  }
}
