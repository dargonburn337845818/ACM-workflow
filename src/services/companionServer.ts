import * as http from 'http';
import * as vscode from 'vscode';
import * as path from 'path';
import { Problem } from '../types';
import { parseCfProblemUrl } from './cfUrl';
import { createProblemFile } from './template';

/**
 * Competitive Companion 兼容接收服务。
 *
 * Codeforces 有反爬，扩展自身抓取不稳定。
 * 借鉴 cph 的成熟方案：用户在浏览器安装 competitive-companion 插件，
 * 打开题目页点插件图标，插件在真实浏览器环境里提取题目与样例，
 * POST 到本服务（默认端口 27121，与 cph 一致），我们收到后自动创建
 * 题目文件 + .prob 测试配置，并打开文件供内置测试器使用。
 */

function problemFromCompanion(raw: any): { problem: Problem; tests: { input: string; output: string }[] } {
  const url: string = String(raw?.url || '');
  const name: string = String(raw?.name || '');
  const tests: { input: string; output: string }[] = (raw?.tests || []).map((t: any) => ({
    input: String(t?.input ?? ''),
    output: String(t?.output ?? '')
  }));

  const platform = 'codeforces' as const;
  let id = '';
  if (url) {
    try {
      id = parseCfProblemUrl(url).id;
    } catch {
      id = '';
    }
  }

  // name 形如 "P1000. 超级玛丽游戏" / "1650C. Weight ..."，去掉题号前缀
  const title = name.replace(/^[A-Za-z0-9]+\.[\s\u00a0]*/, '').trim() || name;
  return { problem: { id, platform, title, tags: [], url }, tests };
}

const MAX_BODY_BYTES = 1024 * 1024; // 1MB：companion 题目 JSON 足够，防止本地服务被塞大请求

export function startCompanionServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    let raw = '';
    let bodyTooLarge = false;
    req.on('data', (c) => {
      if (bodyTooLarge) return;
      raw += c;
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
        bodyTooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '请求体过大（超过 1MB）' }));
      }
    });
    req.on('end', () => {
      if (bodyTooLarge) return;
      void (async () => {
        try {
          const json = JSON.parse(raw);
          const { problem, tests } = problemFromCompanion(json);
          if (!problem.id) {
            throw new Error('无法从推送的 URL 解析题目编号');
          }
          const filePath = createProblemFile(problem, tests);
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
          await vscode.window.showTextDocument(doc, { preview: false });
          vscode.window.showInformationMessage(
            `✅ 已从浏览器接收题目 ${problem.id}（${tests.length} 组样例）：${path.basename(filePath)}`
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e: any) {
          vscode.window.showErrorMessage(`接收题目失败：${e?.message || e}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
        }
      })();
    });
  });
  server.on('error', (err: any) => {
    vscode.window.showErrorMessage(
      `接收端口 ${port} 启动失败：${err?.message || err}（可能被占用或已有 cph 在运行，可在设置 acmWorkflow.companionPort 修改端口）`
    );
  });
  server.listen(port, '127.0.0.1');
  return server;
}
