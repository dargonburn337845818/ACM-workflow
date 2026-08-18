import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, execFileSync } from 'child_process';
import { findCompiler } from './runner';

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

export type DataGenType = 'array' | 'tree' | 'graph' | 'string' | 'permutation' | 'script';

export interface DataGenSpec {
  type: DataGenType;
  // array / permutation
  nMin?: number;
  nMax?: number;
  // array
  vMin?: number;
  vMax?: number;
  sorted?: 'none' | 'asc' | 'desc';
  // tree
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

  // 简单图随机不重复边：n 小时全量洗牌取前 m 条；n 大时拒绝采样（避免 O(n²) 内存）
  const edges: [number, number][] = [];
  if (n <= 4000) {
    const all: [number, number][] = [];
    for (let u = 1; u <= n; u++) {
      for (let v = 1; v <= n; v++) {
        if (u === v) continue;
        if (!directed && u > v) continue;
        all.push([u, v]);
      }
    }
    shuffle(rng, all);
    edges.push(...all.slice(0, m));
  } else {
    const seen = new Set<number>();
    const key = (u: number, v: number) => u * (n + 1) + v;
    let guard = 0;
    while (edges.length < m && guard < m * 50 + 1000) {
      const u = randInt(rng, 1, n);
      const v = randInt(rng, 1, n);
      if (u === v) continue;
      if (!directed && u > v) continue;
      const k = directed ? key(u, v) : key(Math.min(u, v), Math.max(u, v));
      if (seen.has(k)) { guard++; continue; }
      seen.add(k);
      edges.push([u, v]);
      guard = 0;
    }
    // 极端稀疏图兜底：顺序补边保证达到 m
    if (edges.length < m) {
      outer: for (let u = 1; u <= n && edges.length < m; u++) {
        for (let v = 1; v <= n && edges.length < m; v++) {
          if (u === v) continue;
          if (!directed && u > v) continue;
          const k = directed ? key(u, v) : key(Math.min(u, v), Math.max(u, v));
          if (!seen.has(k)) {
            seen.add(k);
            edges.push([u, v]);
          }
        }
      }
    }
  }

  const lines: string[] = [`${n} ${m}`];
  for (const [u, v] of edges) {
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
  let pool = CHARSETS[spec.charset || 'lower'] || String(spec.charset || 'ab');
  if (!pool) pool = 'ab';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += pool[randInt(rng, 0, pool.length - 1)];
  }
  return `${out}\n`;
}

function genPermutation(spec: DataGenSpec, rng: Rng): string {
  const n = randInt(rng, clampInt(spec.nMin, 10, 1, 1000000), clampInt(spec.nMax, 10, 1, 1000000));
  const p = shuffle(rng, Array.from({ length: n }, (_, i) => i + 1));
  return `${n}\n${p.join(' ')}\n`;
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
      execFileSync(compiler, ['-O2', '-std=c++17', scriptPath, '-o', exe], {
        encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
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
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      if (!settled) { settled = true; reject(new Error('生成脚本运行超时（>15s）')); }
    }, SCRIPT_RUN_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`生成脚本无法运行：${e.message}`)); }
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`生成脚本退出码 ${code}：${stderr.slice(0, 400)}`));
        return;
      }
      if (!stdout.trim()) {
        reject(new Error('生成脚本没有输出任何数据'));
        return;
      }
      resolve(stdout);
    });
  });
}

// ===== 统一入口 =====

/** 按规格生成一组随机数据（作为程序 stdin 的文本） */
export async function generateInput(spec: DataGenSpec, rng?: Rng): Promise<string> {
  const r = rng || newRng();
  switch (spec.type) {
    case 'array': return genArray(spec, r);
    case 'tree': return genTree(spec, r);
    case 'graph': return genGraph(spec, r);
    case 'string': return genString(spec, r);
    case 'permutation': return genPermutation(spec, r);
    case 'script': return runScript(spec.scriptPath || '');
    default: throw new Error(`未知数据类型：${(spec as any).type}`);
  }
}
