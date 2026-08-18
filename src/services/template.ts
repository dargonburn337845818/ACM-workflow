import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { Problem } from '../types';
import { resolveBaseDir, resolveTemplatePath } from '../utils/paths';

/** 扩展数据根目录（配置 acmWorkflow.baseDir，留空 → ~/.acm-workflow） */
function baseDir(): string {
  return resolveBaseDir();
}

/** 题目模板路径（配置 acmWorkflow.templatePath，留空 → 内置默认模板） */
function templatePath(): string {
  return resolveTemplatePath();
}

const PLATFORM_DIRS: Record<string, string> = {
  codeforces: 'Codeforces'
};

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_ -]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** 把 WSL 路径 /mnt/c/... 转成 Windows 路径 C:\...；非 /mnt 路径原样返回 null */
function windowsPathOf(p: string): string | null {
  const m = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(p);
  if (m) {
    return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
  }
  return null;
}

/** CPH .prob 的 srcPath 候选：同时覆盖 WSL 路径、Windows 盘符大小写，保证两端都能命中 */
function cphSrcPathVariants(filePath: string): Set<string> {
  const variants = new Set<string>([filePath]);
  const win = windowsPathOf(filePath);
  if (win) {
    variants.add(win);
    variants.add(win.replace(/^([A-Za-z])(?=:)/, (_m, c: string) => c.toLowerCase()));
  }
  variants.add(filePath.replace(/^([A-Za-z])(?=:)/, (_m, c: string) => c.toLowerCase()));
  return variants;
}

/** 解析最终模板内容：用户模板文件（存在时）→ 内置默认模板（带题号/URL 头注释） */
function resolveTemplate(headerId: string, headerUrl: string): string {
  let template = `// ${headerId}\n// ${headerUrl}\n#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n\n  return 0;\n}\n`;
  const tpl = templatePath();
  if (tpl && fs.existsSync(tpl)) {
    template = fs.readFileSync(tpl, 'utf8');
  }
  return template;
}

/**
 * 生成结构：{baseDir}/code/{平台}/{题号}/题目名.cpp
 * 例：{baseDir}/code/Codeforces/1650C/Weight_of_the_System_of_Nested_Segments.cpp
 */
export function createProblemFile(problem: Problem, tests: { input: string; output: string }[]): string {
  const template = resolveTemplate(`${problem.id} - ${problem.title}`, problem.url);

  const platformDir = PLATFORM_DIRS[problem.platform] || 'Other';
  const codeDir = path.join(baseDir(), 'code');
  const baseDirPath = path.join(codeDir, platformDir);
  fs.mkdirSync(baseDirPath, { recursive: true });

  const folderName = problem.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const problemDir = path.join(baseDirPath, folderName);
  fs.mkdirSync(problemDir, { recursive: true });

  // 题名清洗后可能为空（纯符号题名），退回题号，避免生成 ".cpp" 隐藏文件
  let fileName = sanitizeFileName(problem.title) + '.cpp';
  if (fileName === '.cpp') {
    fileName = sanitizeFileName(problem.id) + '.cpp';
  }
  const filePath = path.join(problemDir, fileName);

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, template, 'utf8');
  }

  // 生成 CPH 的 .prob 配置文件，模拟浏览器插件推送后的结果。
  //
  // CPH 按 document.fileName 的 md5 生成/查找 .prob 文件名，而 VS Code 在
  // Windows 上返回的盘符大小写并不稳定（大写和小写盘符都可能出现），
  // 大小写不一致会导致 CPH 找不到 .prob、侧边栏没有测试用例。
  // 因此这里同时生成大写盘符和小写盘符两份 .prob；WSL 下额外生成 /mnt 对应的
  // Windows 路径，保证 WSL 与 Windows 两端都能命中。
  const cphDir = path.join(problemDir, '.cph');
  fs.mkdirSync(cphDir, { recursive: true });

  const batchId = randomUUID();
  const srcPathVariants = cphSrcPathVariants(filePath);

  for (const cphSrcPath of srcPathVariants) {
    const prob = {
      name: `${problem.id}. ${problem.title}`,
      group: 'Codeforces',
      url: problem.url,
      interactive: false,
      memoryLimit: 256,
      timeLimit: 2000,
      tests: tests.map((t, i) => ({
        id: Date.now() + i,
        input: t.input,
        output: t.output
      })),
      testType: 'single',
      input: { type: 'stdin' },
      output: { type: 'stdout' },
      languages: {
        java: {
          mainClass: 'Main',
          taskClass: ''
        }
      },
      batch: {
        id: batchId,
        size: 1
      },
      srcPath: cphSrcPath
    };

    const md5 = createHash('md5').update(cphSrcPath).digest('hex');
    const probFileName = `.${fileName}_${md5}.prob`;
    fs.writeFileSync(path.join(cphDir, probFileName), JSON.stringify(prob), 'utf8');
  }

  return filePath;
}

/**
 * 保存测试用例（保留每个用例的 id）到 filePath 对应的全部 .prob（大写/小写两份）。
 * 用于测试视图里编辑用例后的保存。返回是否更新了至少一份。
 */
export function saveProblemTests(filePath: string, tests: { id: number; input: string; output: string }[]): boolean {
  const cphDir = path.join(path.dirname(filePath), '.cph');
  const fileName = path.basename(filePath);
  const variants = cphSrcPathVariants(filePath);
  let updated = false;
  for (const v of variants) {
    const md5 = createHash('md5').update(v).digest('hex');
    const probPath = path.join(cphDir, `.${fileName}_${md5}.prob`);
    if (fs.existsSync(probPath)) {
      try {
        const prob = JSON.parse(fs.readFileSync(probPath, 'utf8'));
        prob.tests = tests.map((t) => ({ id: t.id, input: t.input, output: t.output }));
        fs.writeFileSync(probPath, JSON.stringify(prob), 'utf8');
        updated = true;
      } catch (e) {
        console.error('saveProblemTests failed', e);
      }
    }
  }
  return updated;
}

/**
 * 列出全部已生成的题目 cpp 绝对路径（Codeforces），用于批量补样例。
 */
export function listProblemCpps(): string[] {
  const codeDir = path.join(baseDir(), 'code');
  const results: string[] = [];
  for (const platform of Object.values(PLATFORM_DIRS)) {
    const base = path.join(codeDir, platform);
    if (!fs.existsSync(base)) continue;
    results.push(...fs.readdirSync(base)
      .filter((d) => fs.statSync(path.join(base, d)).isDirectory())
      .map((d) => {
        const dir = path.join(base, d);
        const cpp = fs.readdirSync(dir).find((f) => f.endsWith('.cpp'));
        return cpp ? path.join(dir, cpp) : null;
      })
      .filter((p): p is string => p !== null));
  }
  return results;
}

/**
 * 按题目 ID 查找本地是否已生成（V0.23 URL 导入查重用）。
 * 目录命名与 createProblemFile 一致：code/Codeforces/{sanitizedId}/ 下的第一个 .cpp。
 * 返回 cpp 绝对路径；不存在返回 null。
 */
export function findProblemCppById(problemId: string): string | null {
  const folderName = problemId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(baseDir(), 'code', 'Codeforces', folderName);
  if (!fs.existsSync(dir)) return null;
  try {
    const cpp = fs.readdirSync(dir).find((f) => f.endsWith('.cpp'));
    return cpp ? path.join(dir, cpp) : null;
  } catch {
    return null;
  }
}

/**
 * 找到 filePath 对应的 CPH .prob 文件（大写/小写盘符两份中任一），找不到返回 null。
 * 用于"重新获取测试数据"时定位题目 URL。
 */
export function findProbFile(filePath: string): string | null {
  const cphDir = path.join(path.dirname(filePath), '.cph');
  const fileName = path.basename(filePath);
  const variants = cphSrcPathVariants(filePath);
  for (const v of variants) {
    const md5 = createHash('md5').update(v).digest('hex');
    const probPath = path.join(cphDir, `.${fileName}_${md5}.prob`);
    if (fs.existsSync(probPath)) {
      return probPath;
    }
  }
  return null;
}

/**
 * 把新抓到的测试数据写回 filePath 对应的全部 .prob（大写/小写两份都更新），
 * 保证 CPH 无论按哪种盘符大小写查找都能拿到最新样例。返回是否更新了至少一份。
 */
export function updateProblemTests(filePath: string, tests: { input: string; output: string }[]): boolean {
  const cphDir = path.join(path.dirname(filePath), '.cph');
  const fileName = path.basename(filePath);
  const variants = cphSrcPathVariants(filePath);
  let updated = false;
  const now = Date.now();
  for (const v of variants) {
    const md5 = createHash('md5').update(v).digest('hex');
    const probPath = path.join(cphDir, `.${fileName}_${md5}.prob`);
    if (fs.existsSync(probPath)) {
      try {
        const prob = JSON.parse(fs.readFileSync(probPath, 'utf8'));
        prob.tests = tests.map((t, i) => ({ id: now + i, input: t.input, output: t.output }));
        fs.writeFileSync(probPath, JSON.stringify(prob), 'utf8');
        updated = true;
      } catch (e) {
        console.error('updateProblemTests failed', e);
      }
    }
  }
  return updated;
}

// ===== 比赛一键创建（模块二）=====

export interface ContestProblemInfo {
  contestId: number;
  index: string;
  name: string;
  rating?: number;
  tags: string[];
}

/** 写 CPH 兼容的 .prob（.cph/ 目录 + 双盘符 md5），让内置测试面板能加载比赛题目 */
function writeCphProbForContest(filePath: string, prob: { name: string; url: string; tests: { id: number; input: string; output: string }[] }): void {
  const cphDir = path.join(path.dirname(filePath), '.cph');
  fs.mkdirSync(cphDir, { recursive: true });
  const fileName = path.basename(filePath);
  const batchId = randomUUID();
  const srcPathVariants = cphSrcPathVariants(filePath);
  for (const cphSrcPath of srcPathVariants) {
    const cphProb = {
      name: prob.name,
      group: 'Codeforces',
      url: prob.url,
      interactive: false,
      memoryLimit: 256,
      timeLimit: 2000,
      tests: prob.tests,
      testType: 'single',
      input: { type: 'stdin' },
      output: { type: 'stdout' },
      languages: { java: { mainClass: 'Main', taskClass: '' } },
      batch: { id: batchId, size: 1 },
      srcPath: cphSrcPath
    };
    const md5 = createHash('md5').update(cphSrcPath).digest('hex');
    fs.writeFileSync(path.join(cphDir, `.${fileName}_${md5}.prob`), JSON.stringify(cphProb), 'utf8');
  }
}

/**
 * 一键创建比赛全部题目（模块二）：
 * 生成目录 {baseDir}\code\Codeforces\Contest_{contestId}\
 * 每道题生成 contest_{contestId}_{index}.cpp（如 contest_1234_A.cpp），
 * 同名 .prob 存储题号/名称/URL/难度/标签，另写 .cph/ 双盘符 .prob 供测试面板使用。
 * 返回 [{filePath, probPath}]（已存在的文件不覆盖）。
 */
export function createContestProblemFiles(
  contestId: number,
  problems: ContestProblemInfo[]
): { filePath: string; probPath: string }[] {
  const contestDir = path.join(baseDir(), 'code', 'Codeforces', `Contest_${contestId}`);
  fs.mkdirSync(contestDir, { recursive: true });

  const results: { filePath: string; probPath: string }[] = [];
  for (const p of problems) {
    const base = `contest_${contestId}_${p.index}`;
    const filePath = path.join(contestDir, base + '.cpp');
    const probPath = path.join(contestDir, base + '.prob');
    const url = `https://codeforces.com/contest/${contestId}/problem/${p.index}`;

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, resolveTemplate(`${base} - ${p.name}`, url), 'utf8');
    }

    // 人读 .prob：题号 / 名称 / URL / 难度 / 标签 / 样例（V0.17.1 起样例抓取后写入 samples 字段）
    if (!fs.existsSync(probPath)) {
      const probData = {
        source: 'contest',
        contestId,
        index: p.index,
        name: p.name,
        url,
        rating: p.rating,
        tags: p.tags,
        samples: [] as { input: string; output: string }[]
      };
      fs.writeFileSync(probPath, JSON.stringify(probData, null, 2), 'utf8');
    }

    // CPH .prob（双盘符）：测试面板 / 补样例可用
    writeCphProbForContest(filePath, { name: `${p.index}. ${p.name}`, url, tests: [] });

    results.push({ filePath, probPath });
  }
  return results;
}

/**
 * 把抓到的样例写入比赛题目（V0.17.1）：
 * 1) 平级人读 .prob 的 samples 字段（[{input, output}]）；
 * 2) .cph 双盘符 .prob 的 tests 字段（测试面板数据源，pushTestState 直接读取）。
 * 返回是否更新成功。
 */
export function updateContestProblemSamples(
  filePath: string,
  tests: { input: string; output: string }[]
): boolean {
  let updated = false;

  // 平级 .prob（source: contest）
  const probPath = path.join(path.dirname(filePath), path.basename(filePath).replace(/\.cpp$/i, '') + '.prob');
  if (fs.existsSync(probPath)) {
    try {
      const prob = JSON.parse(fs.readFileSync(probPath, 'utf8'));
      prob.samples = tests.map((t) => ({ input: t.input, output: t.output }));
      fs.writeFileSync(probPath, JSON.stringify(prob, null, 2), 'utf8');
      updated = true;
    } catch (e) {
      console.error('[ACM-Workflow][比赛] 平级 .prob 样例写入失败', e);
    }
  }

  // .cph 双盘符 tests（复用现有双写逻辑）
  const ok = updateProblemTests(filePath, tests);
  return updated || ok;
}

/** 标记某题样例抓取失败（V0.17.1）：平级 .prob + .cph 双盘符都打标记，测试面板据此提示 */
export function markSamplesFetchFailed(filePath: string): void {
  // 平级 .prob
  const probPath = path.join(path.dirname(filePath), path.basename(filePath).replace(/\.cpp$/i, '') + '.prob');
  if (fs.existsSync(probPath)) {
    try {
      const prob = JSON.parse(fs.readFileSync(probPath, 'utf8'));
      prob.samplesFetchFailed = true;
      fs.writeFileSync(probPath, JSON.stringify(prob, null, 2), 'utf8');
    } catch { /* 忽略 */ }
  }
  // .cph 双盘符（WSL 下含 /mnt 对应的 Windows 路径）
  const cphDir = path.join(path.dirname(filePath), '.cph');
  const fileName = path.basename(filePath);
  const variants = cphSrcPathVariants(filePath);
  for (const v of variants) {
    const md5 = createHash('md5').update(v).digest('hex');
    const cphPath = path.join(cphDir, `.${fileName}_${md5}.prob`);
    if (fs.existsSync(cphPath)) {
      try {
        const prob = JSON.parse(fs.readFileSync(cphPath, 'utf8'));
        prob.samplesFetchFailed = true;
        fs.writeFileSync(cphPath, JSON.stringify(prob), 'utf8');
      } catch { /* 忽略 */ }
    }
  }
}
