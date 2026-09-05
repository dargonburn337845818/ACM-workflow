import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { fetchBinary } from './fetchers/codeforces';

/**
 * 题面 HTML 排版（V0.20 重构）：
 * 用 cheerio 解析 Codeforces 题目页，从 div.problem-statement 中提取
 * 标题、时间/内存限制、题目描述、输入输出格式、样例、提示等区块。
 *
 * 排版规则：
 *  1. 文本节点合并：合并同一父级下的相邻文本，块级元素之间换行，
 *     行内元素之间按「两侧都是文字则补一个空格」保留必要空格；
 *  2. LaTeX 公式边界保护：CF 的 span.tex-span 与文本中的 \(..\) \[..\] $..$ $$..$$
 *     统一包进 <span class="acm-math"> / <div class="acm-math acm-math-block">，
 *     公式内部绝不插入换行/空格碎片，原始 LaTeX 源码原样保留；
 *  3. 配图下载为 data URI 内嵌（失败回退绝对链接）；
 *  4. 输出结构清晰的 HTML 字符串（含标题/限制行/区块标题/段落/样例），
 *     供 Webview 直接渲染，并随本地缓存落盘（离线同样排版良好）。
 */

export type StatementImageDownloader = (url: string) => Promise<{ mime: string; base64: string } | null>;

export interface StatementParseResult {
  /** 排版后的完整题面 HTML（标题 + 限制行 + 各区块） */
  html: string;
  title: string;
  timeLabel?: string;
  memoryLabel?: string;
  timeLimitMs?: number;
  memoryLimitMb?: number;
}

/* ---------------- 文本工具 ---------------- */

const THIN_SPACES = /[\u2009\u200a\u202f\u00a0]/g;

/** 折叠空白：thin space / nbsp 归一为普通空格，连续空白压成单个 */
function collapseText(s: string): string {
  return s.replace(THIN_SPACES, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 去掉 LaTeX 定界符（$$$..$$$ / $$..$$ / \[..\] / \(..\) / $..$），供 KaTeX 直接渲染 */
function stripMathDelimiters(src: string): string {
  const s = src.trim();
  const pairs: [string, string][] = [
    ['$$$', '$$$'],
    ['$$', '$$'],
    ['\\[', '\\]'],
    ['\\(', '\\)'],
    ['$', '$']
  ];
  for (const [left, right] of pairs) {
    if (s.startsWith(left) && s.endsWith(right) && s.length >= left.length + right.length) {
      return s.slice(left.length, s.length - right.length).trim();
    }
  }
  return s;
}

/** 文本中的 LaTeX 边界：$$$..$$$ | $$..$$ | \[..\] | \(..\) | $..$（按此顺序匹配，互不拆分） */
const MATH_TEXT_RE = /\$\$\$[\s\S]*?\$\$\$|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+\$/g;

/**
 * 把纯文本中的公式片段替换为 acm-math 标签（其余部分做 HTML 转义）。
 * 公式内部保持原样（不折叠空白），保证渲染引擎能识别完整公式。
 */
function protectMathText(text: string): string {
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(MATH_TEXT_RE.source, 'g');
  while ((m = re.exec(text))) {
    parts.push(escapeHtml(text.slice(last, m.index)));
    const raw = m[0];
    // CF 题面用 $$$..$$$ 表示行内公式，必须先于 $$..$$ 识别，且按行内处理
    const triple = raw.startsWith('$$$');
    const block = !triple && (raw.startsWith('$$') || raw.startsWith('\\['));
    // 定界符长度：$$$..$$$ 是 3 字符；$$..$$ / \[..\] / \(..\) 都是 2 字符；$..$ 是 1 字符
    const dbl = block || raw.startsWith('\\(');
    const inner = raw.slice(triple ? 3 : (dbl ? 2 : 1), raw.length - (triple ? 3 : (dbl ? 2 : 1))).trim();
    parts.push(block
      ? `<div class="acm-math acm-math-block">${escapeHtml(inner)}</div>`
      : `<span class="acm-math">${escapeHtml(inner)}</span>`);
    last = m.index + raw.length;
  }
  parts.push(escapeHtml(text.slice(last)));
  return parts.join('');
}

/* ---------------- 行内渲染 ---------------- */

const INLINE_KEEP_TAGS = new Set(['i', 'b', 'em', 'strong', 'a', 'sub', 'sup', 'u', 's', 'small', 'code', 'kbd']);

/** 行内标签：出现在区块直接子节点时归入段落缓冲，不单独成块（V0.21） */
const INLINE_TAGS = new Set<string>([...INLINE_KEEP_TAGS, 'span', 'img', 'br', 'font', 'label', 'tt']);

interface InlineChunk {
  html: string;
  text: string; // 可见文本（用于空格判定）
}

interface BuildCtx {
  images: string[]; // 待下载图片 URL（按出现顺序）
}

/** 判断字符是否为「词字符」（两侧都是词字符时补空格） */
function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9\u4e00-\u9fff\u00d7\u2212\u2264\u2265]/.test(ch);
}

/** 行内块拼接：两侧都是词字符 → 补一个空格；标点/括号按源页空格保真；避免双空格 */
function joinInlineChunks(chunks: InlineChunk[]): InlineChunk {
  let html = '';
  let prevText = '';
  for (const c of chunks) {
    if (!c.html) continue;
    const t = c.text;
    if (html && prevText && t) {
      const a = prevText[prevText.length - 1];
      const b = t[0];
      if (!/\s/.test(a) && !/\s/.test(b) && isWordChar(a) && isWordChar(b)) html += ' ';
    }
    if (html && /\s$/.test(html) && /^\s/.test(c.html)) html = html.replace(/\s+$/, '');
    html += c.html;
    prevText = t;
  }
  return { html, text: prevText };
}

function renderInlineChildren($: cheerio.CheerioAPI, el: AnyNode, ctx: BuildCtx): InlineChunk {
  const chunks: InlineChunk[] = [];
  $(el).contents().each((_i, node) => {
    const c = renderInlineNode($, node, ctx);
    if (c.html) chunks.push(c);
  });
  return joinInlineChunks(chunks);
}

/**
 * 把 CF tex-span 内的 HTML 子节点转成 LaTeX 源码。
 * 修复：`10<sup>5</sup>` → `10^{5}`、`x<sub>i</sub>` → `x_{i}`，
 * 斜体/加粗等行内标签按数学模式语义扁平化或转成 LaTeX 命令。
 */
function renderTexSpanSource($: cheerio.CheerioAPI, $el: cheerio.Cheerio<AnyNode>): string {
  let out = '';
  $el.contents().each((_i, node) => {
    if (node.type === 'text') {
      out += (node.data || '').replace(THIN_SPACES, ' ').replace(/\s+/g, ' ').trim();
      return;
    }
    if (node.type !== 'tag') return;
    const name = node.name;
    if (name === 'sup') {
      out += '^{' + renderTexSpanSource($, $(node)) + '}';
    } else if (name === 'sub') {
      out += '_{' + renderTexSpanSource($, $(node)) + '}';
    } else if (name === 'i' || name === 'em') {
      // 数学模式下变量默认斜体，去掉 <i>/<em> 即可，避免出现多余 HTML 标签
      out += renderTexSpanSource($, $(node));
    } else if (name === 'br') {
      out += ' ';
    } else if (name === 'b' || name === 'strong') {
      out += '\\mathbf{' + renderTexSpanSource($, $(node)) + '}';
    } else {
      out += renderTexSpanSource($, $(node));
    }
  });
  return out;
}

function renderInlineNode($: cheerio.CheerioAPI, node: AnyNode, ctx: BuildCtx): InlineChunk {
  if (node.type === 'text') {
    const collapsed = (node.data || '').replace(THIN_SPACES, ' ').replace(/\s+/g, ' ');
    if (!collapsed.trim()) return { html: '', text: '' };
    // 保留首尾单空格：标点/括号前源页有空格时排版保真（如 "w (1 ≤ w ≤ 100)"）
    return { html: protectMathText(collapsed), text: collapsed };
  }
  if (node.type !== 'tag') return { html: '', text: '' };
  const $el = $(node);
  const name = node.name;
  if (name === 'br') return { html: '<br>', text: ' ' };
  if (name === 'img') {
    const src = String($el.attr('src') || '');
    if (!src) return { html: '', text: '' };
    const key = `__ACM_IMG_${ctx.images.length}__`;
    ctx.images.push(src);
    return {
      html: `<img class="st-img" alt="${escapeHtml(String($el.attr('alt') || ''))}" src="${key}">`,
      text: ' '
    };
  }
  if (name === 'span') {
    const cls = String($el.attr('class') || '');
    if (cls.includes('tex-span')) {
      // CF 行内公式：把 span 内 HTML 转成 LaTeX 源码（不拆分、不折叠内部），去掉外层定界符
      const src = stripMathDelimiters(renderTexSpanSource($, $el));
      if (!src) return { html: '', text: '' };
      return { html: `<span class="acm-math">${escapeHtml(src)}</span>`, text: src };
    }
    if (cls.includes('tex-font-style-tt')) {
      const src = collapseText($el.text());
      return { html: `<code class="st-code">${escapeHtml(src)}</code>`, text: src };
    }
    if (cls.includes('section-title')) return { html: '', text: '' }; // 区块标题由我们生成
    // 普通 span：扁平化子节点
    return renderInlineChildren($, node, ctx);
  }
  if (INLINE_KEEP_TAGS.has(name)) {
    const inner = renderInlineChildren($, node, ctx);
    return { html: `<${name}>${inner.html}</${name}>`, text: inner.text };
  }
  // 其余标签（含无 class div 出现在行内）：扁平化
  return renderInlineChildren($, node, ctx);
}

/* ---------------- 块级渲染 ---------------- */

const BLOCK_TAGS = new Set(['p', 'div', 'ul', 'ol', 'li', 'pre', 'table', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** 段落包装：可翻译块（.st-block.st-p > .st-en），供双语对齐与翻译管线识别 */
function wrapPara(innerHtml: string): string {
  return `<div class="st-block st-p"><div class="st-en">${innerHtml}</div></div>`;
}

/**
 * 区块内容渲染：行内碎片（文本节点 / tex-span / img / br 等）先归入缓冲，
 * 遇到块级元素或区块结束才 flush 成一个段落。
 * V0.21：修复「正文未包 <p> 的题目（如 2039F2）」被逐碎片拆成多个段落块
 * （每字符/每公式一个块 → 换行碎片）的问题。
 */
function renderSectionBlocks($: cheerio.CheerioAPI, $root: cheerio.Cheerio<AnyNode>, ctx: BuildCtx): string {
  let out = '';
  let pending: InlineChunk[] = [];
  const flush = () => {
    if (!pending.length) return;
    const joined = joinInlineChunks(pending);
    pending = [];
    if (joined.html) out += wrapPara(joined.html.replace(/^\s+/, '').replace(/\s+$/, ''));
  };
  $root.contents().each((_i, node) => {
    const anyNode = node as any;
    if (anyNode.type === 'text') {
      const c = renderInlineNode($, node, ctx);
      if (c.html) pending.push(c);
      return;
    }
    if (anyNode.type !== 'tag') return;
    const name = anyNode.name;
    if (name === 'br') {
      pending.push({ html: '<br>', text: ' ' });
      return;
    }
    if (INLINE_TAGS.has(name)) {
      const c = renderInlineNode($, node, ctx);
      if (c.html) pending.push(c);
      return;
    }
    flush();
    out += renderBlockNode($, node, ctx);
  });
  flush();
  return out;
}

function renderBlockNode($: cheerio.CheerioAPI, node: AnyNode, ctx: BuildCtx): string {
  if (node.type !== 'tag') return '';
  const $el = $(node);
  const name = node.name;
  if (INLINE_TAGS.has(name)) {
    // 行内元素由调用方归组（renderSectionBlocks 的缓冲）；此处兜底直接返回行内 HTML
    return renderInlineNode($, node, ctx).html;
  }
  if (name === 'pre') {
    const code = ($el.text() || '').replace(/\n$/, '').replace(/\r/g, '');
    return `<pre>${escapeHtml(code)}</pre>`;
  }
  // CF 区块内小标题（Input/Output/Note/Examples）由我们的中文区块标题替代，跳过
  if (name === 'div' && String($el.attr('class') || '').includes('section-title')) return '';
  if (name === 'p') {
    const inner = renderInlineChildren($, node, ctx);
    return inner.html ? wrapPara(inner.html) : '';
  }
  if (/^h[1-6]$/.test(name)) {
    const inner = renderInlineChildren($, node, ctx);
    return `<${name}>${inner.html}</${name}>`;
  }
  if (name === 'ul' || name === 'ol') {
    const items = $el.children('li').map((_i, li) => {
      const inner = renderInlineChildren($, li, ctx);
      return `<li>${inner.html}</li>`;
    }).get().join('');
    return items ? wrapPara(`<${name}>${items}</${name}>`) : '';
  }
  if (name === 'table') {
    const rows = $el.find('tr').map((_i, tr) => {
      const cells = $(tr).children('td, th').map((_j, td) => {
        const inner = renderInlineChildren($, td, ctx);
        const tag = $(td).is('th') ? 'th' : 'td';
        return `<${tag}>${inner.html}</${tag}>`;
      }).get().join('');
      return `<tr>${cells}</tr>`;
    }).get().join('');
    return rows ? `<table>${rows}</table>` : '';
  }
  if (name === 'blockquote') {
    const inner = renderInlineChildren($, node, ctx);
    return inner.html ? wrapPara(`<blockquote>${inner.html}</blockquote>`) : '';
  }
  // 通用块（div 等）：含块级子元素 → 递归；仅行内内容 → 作为段落
  const hasBlockChild = $el.children().toArray().some((c) => c.type === 'tag' && BLOCK_TAGS.has(c.name));
  if (hasBlockChild) {
    return renderSectionBlocks($, $el, ctx);
  }
  const inner = renderInlineChildren($, node, ctx);
  return inner.html ? wrapPara(inner.html) : '';
}

/* ---------------- 样例 ---------------- */

function renderSampleTests($: cheerio.CheerioAPI, $root: cheerio.Cheerio<AnyNode>): string {
  let out = '';
  let idx = 0;
  $root.find('.sample-test').each((_i, st) => {
    idx++;
    const input = ($(st).find('.input pre').first().text() || '').replace(/\n$/, '').replace(/\r/g, '');
    const output = ($(st).find('.output pre').first().text() || '').replace(/\n$/, '').replace(/\r/g, '');
    if (input.trim()) out += `<div class="st-sample"><div class="st-sample-title">样例输入 ${idx}</div><pre>${escapeHtml(input)}</pre></div>`;
    if (output.trim()) out += `<div class="st-sample"><div class="st-sample-title">样例输出 ${idx}</div><pre>${escapeHtml(output)}</pre></div>`;
  });
  return out;
}

/**
 * 从排版后的题面 HTML 中移除「样例」区块。
 *
 * 测试模块的「题面」页只展示题目描述/输入输出/提示；
 * 官方样例统一放在「样例」页的可编辑用例中，不在题面页重复展示。
 * 仅影响 Webview 渲染用的 HTML，不改变落盘/缓存中的完整题面。
 */
export function stripSamplesFromStatementHtml(html: string): string {
  const $ = cheerio.load(html);
  // 移除样例内容块（若前面紧跟「样例」标题，标题也一并移除）
  $('.st-sample').each((_i, el) => {
    const $prev = $(el).prev();
    if ($prev.length && $prev.is('h2.st-h') && $prev.text().trim() === '样例') {
      $prev.remove();
    }
    $(el).remove();
  });
  // 兜底：即使没有样例内容块，也不保留空的「样例」标题
  $('h2.st-h').filter((_i, h) => $(h).text().trim() === '样例').remove();
  return $('body').html() || '';
}

/* ---------------- 限制提取 ---------------- */

/** 取 .time-limit / .memory-limit 的值文本（去掉 property-title） */
function limitText($: cheerio.CheerioAPI, $stmt: cheerio.Cheerio<AnyNode>, sel: string): string | null {
  const $el = $stmt.find(sel).first();
  if (!$el.length) return null;
  const $clone = $el.clone();
  $clone.find('.property-title').remove();
  const v = collapseText($clone.text());
  return v || null;
}

/** "1 second" / "250 ms" → "1s" / "250ms" */
function formatTimeLimit(raw: string): string {
  const m = /([\d.]+)\s*(second|seconds|s|ms|millisecond|milliseconds)?/i.exec(raw);
  if (!m) return raw;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  return unit.startsWith('ms') ? n + 'ms' : n + 's';
}

/** "64 megabytes" / "256 MB" → "64 MB" / "256 MB" */
function formatMemLimit(raw: string): string {
  const m = /([\d.]+)\s*(megabyte|megabytes|mb|m)?/i.exec(raw);
  if (!m) return raw;
  return parseFloat(m[1]) + ' MB';
}

function timeToMs(label: string): number | undefined {
  const m = /([\d.]+)\s*(ms|s)/.exec(label);
  if (!m) return undefined;
  return m[2] === 'ms' ? parseFloat(m[1]) : parseFloat(m[1]) * 1000;
}

/** 从排版后的 HTML 中恢复限制（缓存命中离线显示/测试 TLE 用） */
export function parseLimitsFromHtml(html: string): { timeLimitMs?: number; memoryLimitMb?: number } {
  const out: { timeLimitMs?: number; memoryLimitMb?: number } = {};
  const m = /时间限制：([\d.]+)(ms|s)\s*\|\s*内存限制：([\d.]+)\s*MB/.exec(html);
  if (m) {
    out.timeLimitMs = m[2] === 'ms' ? parseFloat(m[1]) : parseFloat(m[1]) * 1000;
    out.memoryLimitMb = parseFloat(m[3]);
  }
  return out;
}

/* ---------------- 图片下载 ---------------- */

const defaultDownloadImage: StatementImageDownloader = async (url) => {
  try {
    const abs = url.startsWith('//') ? 'https:' + url : url;
    const bin = await fetchBinary(abs);
    if (!bin) return null;
    return { mime: bin.mime, base64: bin.data.toString('base64') };
  } catch {
    return null;
  }
};

async function resolveImages(urls: string[], download?: StatementImageDownloader): Promise<string[]> {
  const dl = download || defaultDownloadImage;
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const u of urls) {
    if (seen.has(u)) { out.push(seen.get(u)!); continue; }
    if (/^data:/i.test(u)) { seen.set(u, u); out.push(u); continue; }
    let resolved = u.startsWith('//') ? 'https:' + u : u;
    try {
      const bin = await dl(u);
      if (bin) resolved = `data:${bin.mime};base64,${bin.base64}`;
    } catch { /* 保留在线链接 */ }
    seen.set(u, resolved);
    out.push(resolved);
  }
  return out;
}

async function finishHtml(rawHtml: string, ctx: BuildCtx, download?: StatementImageDownloader): Promise<string> {
  const images = await resolveImages(ctx.images, download);
  return rawHtml.replace(/__ACM_IMG_(\d+)__/g, (_m, i) => images[Number(i)] || '');
}

/* ---------------- CF 解析 ---------------- */

export async function parseCfStatementHtml(html: string, download?: StatementImageDownloader): Promise<StatementParseResult> {
  const $ = cheerio.load(html);
  const $stmt = $('.problem-statement').first();
  if (!$stmt.length) throw new Error('未找到题面区块');

  const title = collapseText($('.header .title', $stmt).first().text());
  const timeRaw = limitText($, $stmt, '.time-limit');
  const memRaw = limitText($, $stmt, '.memory-limit');
  const timeLabel = timeRaw ? formatTimeLimit(timeRaw) : undefined;
  const memoryLabel = memRaw ? formatMemLimit(memRaw) : undefined;

  const ctx: BuildCtx = { images: [] };
  const sections: { heading: string; body: string }[] = [];

  // 题目描述：优先 .legend；老题（4A/1A 等）无 legend → header 之后的匿名块
  let legend = $('.legend', $stmt).first();
  if (!legend.length) {
    const header = $('.header', $stmt).first();
    const hNode = header[0];
    if (hNode) {
      let sib: AnyNode | null = (hNode as any).next || null;
      while (sib && sib.type === 'text' && !(sib.data || '').trim()) sib = (sib as any).next || null;
      if (sib && sib.type === 'tag' && sib.name === 'div') legend = $(sib);
    }
  }
  if (legend.length) {
    const body = renderSectionBlocks($, legend, ctx);
    if (body.trim()) sections.push({ heading: '题目描述', body });
  }

  const inSpec = $('.input-specification', $stmt).first();
  if (inSpec.length) {
    const body = renderSectionBlocks($, inSpec, ctx);
    if (body.trim()) sections.push({ heading: '输入格式', body });
  }
  const outSpec = $('.output-specification', $stmt).first();
  if (outSpec.length) {
    const body = renderSectionBlocks($, outSpec, ctx);
    if (body.trim()) sections.push({ heading: '输出格式', body });
  }
  const samples = $('.sample-tests', $stmt).first();
  if (samples.length) {
    const body = renderSampleTests($, samples);
    if (body.trim()) sections.push({ heading: '样例', body });
  }
  const note = $('.note', $stmt).first();
  if (note.length) {
    const body = renderSectionBlocks($, note, ctx);
    if (body.trim()) sections.push({ heading: '提示', body });
  }

  let bodyHtml = '';
  for (const s of sections) bodyHtml += `<h2 class="st-h">${escapeHtml(s.heading)}</h2>${s.body}`;

  const limitsLine = timeLabel || memoryLabel
    ? `<div class="st-limits-inline">时间限制：${escapeHtml(timeLabel || '—')} | 内存限制：${escapeHtml(memoryLabel || '—')}</div>`
    : '';
  const raw = `<h1 class="st-title">${escapeHtml(title || '')}</h1>${limitsLine}${bodyHtml}`;
  const htmlOut = await finishHtml(raw, ctx, download);

  console.log(`[ACM-Workflow][题面] parseCfStatementHtml 完成：标题=${title}，限制=${timeLabel || '-'}/${memoryLabel || '-'}，图片 ${ctx.images.length} 张，HTML ${htmlOut.length} 字符`);
  return {
    html: htmlOut,
    title,
    timeLabel,
    memoryLabel,
    timeLimitMs: timeLabel ? timeToMs(timeLabel) : undefined,
    memoryLimitMb: memoryLabel ? parseFloat(memoryLabel) : undefined
  };
}
