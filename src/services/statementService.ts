import * as vscode from 'vscode';
import { fetchStatement, StatementParseResult } from './fetchers/statement';
import { parseLimitsFromHtml, stripSamplesFromStatementHtml } from './statementHtml';
import { readStatementCache, writeStatementCache } from './statementCache';
import { readStatementFiles, writeStatementFiles } from './statementFiles';
import { countTranslatableParagraphs, translateStatementHtml } from './translate';
import { Problem } from '../types';

export interface LastStatement {
  id: string;
  title: string;
  url: string;
  html: string;
  filePath?: string;
}

/**
 * StatementService facade：封装题面抓取、排版、翻译、缓存与落盘，
 * 并持有当前题面/限制/翻译缓存/抓取中任务等共享状态。
 */
export class StatementService {
  lastStatement: LastStatement | null = null;
  lastLimits: { timeLimitMs?: number; memoryLimitMb?: number } | null = null;
  translateCache = new Map<string, (string | null)[]>();
  statementTasks = new Map<string, Promise<void>>();

  /** 已去掉样例区块的 Webview HTML 缓存：同一份题面反复切换页签/编辑器时不再重复 cheerio 解析。 */
  private readonly viewHtmlCache = new Map<string, string>();
  /** 可翻译段落数缓存：与 viewHtml 同理，避免重复解析。 */
  private readonly translatableCache = new Map<string, number>();
  private static readonly HTML_CACHE_LIMIT = 50;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private cacheSet<T>(map: Map<string, T>, key: string, value: T): void {
    map.set(key, value);
    if (map.size > StatementService.HTML_CACHE_LIMIT) {
      const first = map.keys().next().value;
      if (first !== undefined) map.delete(first);
    }
  }

  async fetchStatement(problem: Problem, download?: Parameters<typeof fetchStatement>[1]): Promise<StatementParseResult> {
    return fetchStatement(problem, download);
  }

  async translate(html: string): Promise<(string | null)[]> {
    return translateStatementHtml(html, { context: this.context });
  }

  countTranslatable(html: string): number {
    const hit = this.translatableCache.get(html);
    if (hit !== undefined) return hit;
    const count = countTranslatableParagraphs(html);
    this.cacheSet(this.translatableCache, html, count);
    return count;
  }

  parseLimits(html: string): { timeLimitMs?: number; memoryLimitMb?: number } {
    return parseLimitsFromHtml(html);
  }

  /** 生成 Webview「题面」页使用的 HTML：移除样例区块，样例统一在「样例」页展示 */
  viewHtml(html: string): string {
    const hit = this.viewHtmlCache.get(html);
    if (hit !== undefined) return hit;
    const view = stripSamplesFromStatementHtml(html);
    this.cacheSet(this.viewHtmlCache, html, view);
    return view;
  }

  readGlobalCache(platform: string, id: string): string | null {
    return readStatementCache(platform, id);
  }

  writeGlobalCache(platform: string, id: string, html: string): void {
    writeStatementCache(platform, id, html);
  }

  readFiles(filePath: string) {
    return readStatementFiles(filePath);
  }

  writeFiles(filePath: string, html: string, zh?: (string | null)[] | null): void {
    writeStatementFiles(filePath, html, zh);
  }
}
