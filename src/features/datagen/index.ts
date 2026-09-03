/**
 * datagen 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 * V0.22 新增：Spark 本地模型一键生成 Python 造数据脚本。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import { DataGenSpec, Services } from '../../services';
import { defaultDataDir } from '../../utils/paths';
import type { WorkbenchHost } from '../../core/workbench';


export function installDatagen(host: WorkbenchHost, deps: Pick<Services, 'judge' | 'workspace' | 'spark'>): void {
  host.handlers['dataGenGenerate'] = (msg: any) => handleDataGenGenerate(host, deps, msg?.payload);
  host.handlers['dataGenSave'] = (msg: any) => handleDataGenSave(host, msg?.payload);
  host.handlers['sparkGenerateScript'] = () => handleSparkGenerateScript(host, deps);
  host.handlers['openSparkScript'] = (msg: any) => handleOpenSparkScript(msg?.payload);
}


async function handleDataGenGenerate(host: WorkbenchHost, deps: Pick<Services, 'judge'>, payload: any) {
  const spec: DataGenSpec = payload?.spec || {};
  if (!spec.type) {
    host.post({ type: 'dataGenStatus', message: '请选择数据类型', isError: true });
    return;
  }
  host.post({ type: 'dataGenStatus', message: '生成中…', busy: true });
  try {
    const input = await deps.judge.generateInput(spec);
    host.post({ type: 'dataGenerated', input });
    host.post({ type: 'dataGenStatus', message: `已生成（${input.length} 字符），并填充到测试面板输入框` });
  } catch (e: any) {
    host.post({ type: 'dataGenStatus', message: e?.message || '生成失败', isError: true, busy: false });
  }
}


async function handleDataGenSave(host: WorkbenchHost, payload: any) {
  const input = String(payload?.input ?? '');
  if (!input) {
    host.post({ type: 'dataGenStatus', message: '没有可保存的数据，请先生成', isError: true });
    return;
  }
  try {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(defaultDataDir(), `data_${Date.now()}.txt`)),
      filters: { '文本文件': ['txt', 'in'], '所有文件': ['*'] }
    });
    if (!uri) return; // 用户取消
    fs.writeFileSync(uri.fsPath, input, 'utf8');
    host.post({ type: 'dataGenStatus', message: `已保存：${uri.fsPath}` });
  } catch (e: any) {
    host.post({ type: 'dataGenStatus', message: `保存失败：${e?.message || e}`, isError: true });
  }
}

/** 读取题目目录里的题面文本：优先 题面.md，其次从 题面.html 抽出纯文本。 */
function readProblemStatement(filePath: string): string {
  const dir = path.dirname(filePath);
  const mdPath = path.join(dir, '题面.md');
  try {
    if (fs.existsSync(mdPath)) {
      const md = fs.readFileSync(mdPath, 'utf8');
      if (md.trim()) return md;
    }
  } catch { /* 读失败继续走 HTML */ }

  const htmlPath = path.join(dir, '题面.html');
  try {
    if (fs.existsSync(htmlPath)) {
      const $ = cheerio.load(fs.readFileSync(htmlPath, 'utf8'));
      $('script, style').remove();
      const text = $('body').text().replace(/\s+/g, ' ').trim();
      return text;
    }
  } catch { /* 无缓存也可，下面用空题面 */ }
  return '';
}

/** 从当前打开的 .cpp 提取题目上下文（.prob + 题面缓存）。 */
function resolveCurrentProblemContext(filePath: string, probPath: string): { title: string; id?: string; url?: string; statement: string } {
  let prob: any = {};
  try {
    prob = JSON.parse(fs.readFileSync(probPath, 'utf8'));
  } catch {
    prob = {};
  }
  const rawName = String(prob?.name || '');
  const title = rawName.replace(/^\d+[A-Za-z]?\.\s*/, '').trim() || rawName || path.basename(filePath, '.cpp');
  const url = String(prob?.url || '');
  const m = /problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/.exec(url) || /contest\/(\d+)\/problem\/([A-Za-z0-9]+)/.exec(url);
  const id = m ? m[1] + m[2] : undefined;
  return { title, id, url: url || undefined, statement: readProblemStatement(filePath) };
}

async function handleSparkGenerateScript(host: WorkbenchHost, deps: Pick<Services, 'workspace' | 'spark'>): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const filePath = editor?.document.fileName || '';
  if (!filePath.toLowerCase().endsWith('.cpp')) {
    host.post({ type: 'sparkStatus', message: '请先打开一个题目 .cpp 文件，再让 AI 生成造数据脚本', isError: true, busy: false });
    return;
  }
  const probPath = deps.workspace.findProbFile(filePath);
  if (!probPath) {
    host.post({ type: 'sparkStatus', message: '未找到当前题目的 .prob 配置，无法自动获取题面上下文', isError: true, busy: false });
    return;
  }

  host.post({ type: 'sparkStatus', message: '正在读取题面并调用本地 Spark 生成脚本…', busy: true });
  try {
    const ctx = resolveCurrentProblemContext(filePath, probPath);
    const code = await deps.spark.generateScriptForProblem(ctx);
    const saved = await deps.spark.validateAndSave(code);
    host.post({ type: 'sparkGenerated', payload: { path: saved.path, code, stdout: saved.stdout } });
  } catch (e: any) {
    host.post({ type: 'sparkStatus', message: e?.message || 'AI 生成脚本失败', isError: true, busy: false });
  }
}

async function handleOpenSparkScript(payload: any): Promise<void> {
  const p = String(payload?.path || '');
  if (!p) return;
  try {
    await vscode.window.showTextDocument(vscode.Uri.file(p));
  } catch (e: any) {
    vscode.window.showWarningMessage(`打开脚本失败：${e?.message || e}`);
  }
}
