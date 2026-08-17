import * as fs from 'fs';
import * as path from 'path';

/**
 * 题面落盘（V0.20）：抓取并排版后的 HTML 与译文直接存进「题目文件夹」
 * （cpp 所在目录，即 code/{平台}/{题号}/），切换界面/离线都直接读盘。
 *
 * 文件约定：
 *   题面.html     —— 排版后的题面 HTML（标题/限制/区块/公式/图片均完整，离线可读）
 *   题面.zh.json  —— { v: 2, zh: (string|null)[] } 段落级译文（v2 与 HTML 段落对齐）
 */

export interface StatementFiles {
  html: string;
  zh: (string | null)[] | null;
}

/** 排版 HTML 缓存版本标记：旧版（V0.20 逐碎片分块/MATH 占位符泄漏）缓存直接失效重抓（V0.21） */
export const HTML_CACHE_MARK = '<!-- acm-workflow-html-v2 -->';

/** 题目文件夹内题面文件的路径（与 cpp 同级） */
export function statementFilePaths(filePath: string): { html: string; zh: string } {
  const dir = path.dirname(filePath);
  return { html: path.join(dir, '题面.html'), zh: path.join(dir, '题面.zh.json') };
}

/** 读题目文件夹里的排版 HTML 与译文；无 题面.html（或版本不符）返回 null；译文缺失/版本不符时 zh 为 null */
export function readStatementFiles(filePath: string): StatementFiles | null {
  try {
    const { html: htmlPath, zh: zhPath } = statementFilePaths(filePath);
    if (!fs.existsSync(htmlPath)) return null;
    const html = fs.readFileSync(htmlPath, 'utf8');
    if (!html || !html.trim()) return null;
    // V0.21：无版本标记的旧缓存（排版有碎片缺陷）不复用，触发重新抓取
    if (!html.trimStart().startsWith(HTML_CACHE_MARK)) return null;
    let zh: (string | null)[] | null = null;
    if (fs.existsSync(zhPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
        // v2：{ v: 2, zh: [...] }；旧版裸数组（v1，按 Markdown 段落对齐）不再使用
        if (parsed && parsed.v === 2 && Array.isArray(parsed.zh)) zh = parsed.zh;
      } catch {
        zh = null;
      }
    }
    return { html, zh };
  } catch {
    return null;
  }
}

/** 把排版后的 HTML（和可选译文）写入题目文件夹；失败只警告，不影响主流程 */
export function writeStatementFiles(filePath: string, html: string, zh?: (string | null)[] | null): void {
  try {
    const { html: htmlPath, zh: zhPath } = statementFilePaths(filePath);
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(htmlPath, HTML_CACHE_MARK + '\n' + html, 'utf8');
    if (zh) fs.writeFileSync(zhPath, JSON.stringify({ v: 2, zh }), 'utf8');
  } catch (e) {
    console.warn('[ACM-Workflow][题面] 题目文件夹落盘失败：', e);
  }
}
