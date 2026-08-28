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

  constructor(private readonly context: vscode.ExtensionContext) {}

  async fetchStatement(problem: Problem, download?: Parameters<typeof fetchStatement>[1]): Promise<StatementParseResult> {
    return fetchStatement(problem, download);
  }

  async translate(html: string): Promise<(string | null)[]> {
    return translateStatementHtml(html, { context: this.context });
  }

  countTranslatable(html: string): number {
    return countTranslatableParagraphs(html);
  }

  parseLimits(html: string): { timeLimitMs?: number; memoryLimitMb?: number } {
    return parseLimitsFromHtml(html);
  }

  /** 生成 Webview「题面」页使用的 HTML：移除样例区块，样例统一在「样例」页展示 */
  viewHtml(html: string): string {
    return stripSamplesFromStatementHtml(html);
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
