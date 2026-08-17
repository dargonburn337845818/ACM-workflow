import { Problem } from '../../types';
import { fetchProblemHtml as fetchCfHtml } from './codeforces';
import { fetchProblemHtml as fetchLuoguHtml } from './luogu';
import {
  parseCfStatementHtml,
  parseLuoguStatementHtml,
  parseLimitsFromHtml,
  StatementParseResult,
  StatementImageDownloader
} from '../statementHtml';

// 兼容导出（V0.20：解析/排版逻辑迁至 services/statementHtml.ts）
export { parseCfStatementHtml, parseLuoguStatementHtml, parseLimitsFromHtml };
export type { StatementParseResult, StatementImageDownloader };

/**
 * 抓取题面并排版为 HTML（V0.20 重构）：
 * 1. 用 cheerio 解析页面 → 提取标题/限制/描述/输入输出/样例/提示；
 * 2. 文本节点智能拼接、公式边界保护（acm-math 标签，内部不拆分）；
 * 3. 配图下载为 data URI 内嵌；
 * 4. 返回排版后的 HTML（随本地缓存落盘，离线同样排版良好）。
 */
export async function fetchStatement(problem: Problem, download?: StatementImageDownloader): Promise<StatementParseResult> {
  console.log(`[ACM-Workflow][题面] fetchStatement 开始: ${problem.platform} ${problem.id} url=${problem.url}`);
  let res: StatementParseResult;
  if (problem.platform === 'luogu') {
    const html = await fetchLuoguHtml(problem.id);
    res = await parseLuoguStatementHtml(html, download);
  } else {
    const html = await fetchCfHtml(problem.url);
    res = await parseCfStatementHtml(html, download);
  }
  console.log(`[ACM-Workflow][题面] fetchStatement 成功: ${problem.id}, HTML ${res.html.length} 字符`);
  return res;
}
