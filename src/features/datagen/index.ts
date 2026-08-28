/**
 * datagen 功能模块（V0.18 结构重组：从 panel.ts 拆出）
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DataGenSpec, Services } from '../../services';
import { defaultDataDir } from '../../utils/paths';
import type { WorkbenchHost } from '../../core/workbench';


export function installDatagen(host: WorkbenchHost, deps: Pick<Services, 'judge'>): void {
  host.handlers['dataGenGenerate'] = (msg: any) => handleDataGenGenerate(host, deps, msg?.payload);
  host.handlers['dataGenSave'] = (msg: any) => handleDataGenSave(host, msg?.payload);
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
