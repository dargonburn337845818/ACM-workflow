import * as fs from 'fs';
import * as path from 'path';
import { HTML_CACHE_MARK } from './statementFiles';
import { resolveBaseDir } from '../utils/paths';

/**
 * 题面全局磁盘缓存（V0.12；V0.20 改为缓存排版后的 HTML）。
 * 抓取成功 → 缓存排版 HTML（30 天）；抓取失败 → 读缓存兜底显示，
 * 保证二次打开（或网络不稳时）题面仍然可见且排版良好。
 */

const STATEMENT_TTL_MS = 30 * 24 * 3600 * 1000; // 30 天

function statementCacheDir(): string {
  return path.join(resolveBaseDir(), 'cache', 'statements');
}

function cachePath(platform: string, id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(statementCacheDir(), platform, `${safeId}.html`);
}

/** 读取缓存的排版 HTML（TTL 内有效 + 版本标记匹配），无缓存/过期/旧版返回 null */
export function readStatementCache(platform: string, id: string): string | null {
  try {
    const p = cachePath(platform, id);
    if (!fs.existsSync(p)) return null;
    const stat = fs.statSync(p);
    if (Date.now() - stat.mtimeMs > STATEMENT_TTL_MS) return null;
    const html = fs.readFileSync(p, 'utf8');
    if (!html || html.trim().length === 0) return null;
    // V0.21：无版本标记的旧缓存（排版缺陷版）不复用
    if (!html.trimStart().startsWith(HTML_CACHE_MARK)) return null;
    return html;
  } catch {
    return null;
  }
}

/** 写入排版 HTML 缓存（带版本标记；失败不影响主流程） */
export function writeStatementCache(platform: string, id: string, html: string): void {
  try {
    const p = cachePath(platform, id);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, HTML_CACHE_MARK + '\n' + html, 'utf8');
  } catch (e) {
    console.warn('[ACM-Workflow][题面] 全局缓存写入失败：', e);
  }
}

/** 清理单题缓存（如用户反馈题面过期时） */
export function clearStatementCache(platform: string, id: string): void {
  try {
    const p = cachePath(platform, id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch { /* ignore */ }
}
