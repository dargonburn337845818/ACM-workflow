import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';

/**
 * 题面落盘（V0.20）：抓取并排版后的 HTML、Markdown 与译文直接存进「题目文件夹」
 * （cpp 所在目录，即 code/{平台}/{题号}/），切换界面/离线都直接读盘。
 *
 * 文件约定：
 *   题面.html     —— 排版后的题面 HTML（标题/限制/区块/公式/图片均完整，离线可读）
 *   题面.md       —— 由 HTML 生成的 Markdown 版（方便外部查看/分享）
 *   题面.zh.json  —— { v: 3, zh: (string|null)[] } 段落级译文（v3 与 HTML 段落对齐）
 */

export interface StatementFiles {
  html: string;
  zh: (string | null)[] | null;
}

/** 排版 HTML 缓存版本标记：旧版（V0.20 逐碎片分块/MATH 占位符泄漏/V0.24 $$$ 公式误判）缓存直接失效重抓 */
export const HTML_CACHE_MARK = '<!-- acm-workflow-html-v4 -->';

/** 题目文件夹内题面文件的路径（与 cpp 同级） */
export function statementFilePaths(filePath: string): { html: string; md: string; zh: string } {
  const dir = path.dirname(filePath);
  return {
    html: path.join(dir, '题面.html'),
    md: path.join(dir, '题面.md'),
    zh: path.join(dir, '题面.zh.json')
  };
}

/** 读题目文件夹里的排版 HTML 与译文；无 题面.html（或版本不符）返回 null；译文缺失/版本不符时 zh 为 null */
export function readStatementFiles(filePath: string): StatementFiles | null {
  try {
    const { html: htmlPath, zh: zhPath } = statementFilePaths(filePath);
    if (!fs.existsSync(htmlPath)) return null;
    const html = fs.readFileSync(htmlPath, 'utf8');
    if (!html || !html.trim()) return null;
    // V0.24：无版本标记的旧缓存（排版/翻译有缺陷）不复用，触发重新抓取
    if (!html.trimStart().startsWith(HTML_CACHE_MARK)) return null;
    let zh: (string | null)[] | null = null;
    if (fs.existsSync(zhPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
        // v3：{ v: 3, zh: [...] }；旧版 v1/v2（MATH 占位符泄漏）不再使用
        if (parsed && parsed.v === 3 && Array.isArray(parsed.zh)) zh = parsed.zh;
      } catch {
        zh = null;
      }
    }
    return { html, zh };
  } catch {
    return null;
  }
}

/** 把排版 HTML 转成适合阅读的 Markdown（供 题面.md 使用） */
function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);
  const lines: string[] = [];

  const title = $('h1.st-title').first().text().replace(/\s+/g, ' ').trim();
  if (title) lines.push('# ' + title);

  const limits = $('.st-limits-inline').first().text().replace(/\s+/g, ' ').trim();
  if (limits) lines.push('', limits);

  $('h2.st-h').each((_i, h) => {
    const heading = $(h).text().replace(/\s+/g, ' ').trim();
    if (heading) lines.push('', '## ' + heading);

    let node = $(h).next();
    while (node.length && !node.is('h2.st-h')) {
      if (node.is('.st-block.st-p')) {
        const text = blockToMarkdown($, node);
        if (text) lines.push('', text);
      } else if (node.is('pre')) {
        const code = $(node).text().replace(/\n$/, '');
        lines.push('', '```', code, '```');
      } else if (node.is('.st-sample')) {
        const sampleTitle = node.find('.st-sample-title').first().text().replace(/\s+/g, ' ').trim();
        const code = node.find('pre').first().text().replace(/\n$/, '');
        if (sampleTitle) lines.push('', '**' + sampleTitle + '**');
        lines.push('', '```', code, '```');
      } else if (node.is('table')) {
        const t = $(node).text().replace(/\s+/g, ' ').trim();
        if (t) lines.push('', t);
      } else {
        const t = $(node).text().replace(/\s+/g, ' ').trim();
        if (t) lines.push('', t);
      }
      node = node.next();
    }
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** 把 .st-block 段落转成 Markdown 文本：公式还原为 $..$ / $$..$$，br 转行 */
function blockToMarkdown($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>): string {
  const $el = $(el).clone();
  $el.find('.acm-math').each((_i, m) => {
    const $m = $(m);
    const src = $m.text().replace(/\s+/g, ' ').trim();
    const block = $m.hasClass('acm-math-block');
    $m.replaceWith((block ? '$$' : '$') + src + (block ? '$$' : '$'));
  });
  $el.find('br').replaceWith('\n');
  return $el.text().replace(/\s+/g, ' ').trim();
}

/** 把排版后的 HTML（和可选译文）写入题目文件夹；失败只警告，不影响主流程 */
export function writeStatementFiles(filePath: string, html: string, zh?: (string | null)[] | null): void {
  try {
    const { html: htmlPath, md: mdPath, zh: zhPath } = statementFilePaths(filePath);
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(htmlPath, HTML_CACHE_MARK + '\n' + html, 'utf8');
    try {
      const md = htmlToMarkdown(html);
      if (md.trim()) fs.writeFileSync(mdPath, md, 'utf8');
    } catch (e) {
      console.warn('[ACM-Workflow][题面] Markdown 生成失败：', e);
    }
    if (zh) fs.writeFileSync(zhPath, JSON.stringify({ v: 3, zh }), 'utf8');
  } catch (e) {
    console.warn('[ACM-Workflow][题面] 题目文件夹落盘失败：', e);
  }
}
