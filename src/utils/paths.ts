/**
 * 路径解析工具：所有「数据目录 / 模板路径 / 数据库路径」的统一入口。
 *
 * 设计原则（开源版）：
 *  - 配置 `acmWorkflow.baseDir` / `templatePath` / `dbPath` 均默认留空；
 *  - 留空时自动落到跨平台默认位置（~/.acm-workflow），不依赖任何个人盘符；
 *  - 用户在设置面板配置后立即生效（函数内读取，不缓存）。
 */
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/** 数据根目录：配置 acmWorkflow.baseDir；留空 → ~/.acm-workflow */
export function resolveBaseDir(): string {
  const custom = vscode.workspace.getConfiguration('acmWorkflow').get<string>('baseDir', '');
  return custom && custom.trim() ? path.resolve(custom.trim()) : path.join(os.homedir(), '.acm-workflow');
}

/** 题目模板路径：配置 acmWorkflow.templatePath；留空 → 使用内置默认模板 */
export function resolveTemplatePath(): string {
  const custom = vscode.workspace.getConfiguration('acmWorkflow').get<string>('templatePath', '');
  return custom && custom.trim() ? path.resolve(custom.trim()) : '';
}

/** 刷题记录数据库路径：配置 acmWorkflow.dbPath；留空 → {baseDir}/records.db */
export function resolveDbPath(): string {
  const custom = vscode.workspace.getConfiguration('acmWorkflow').get<string>('dbPath', '');
  if (custom && custom.trim()) return path.resolve(custom.trim());
  return path.join(resolveBaseDir(), 'records.db');
}

/** 生成 / 导出文件的默认保存目录（造数据、对拍差异等 showSaveDialog 默认位置） */
export function defaultDataDir(): string {
  return resolveBaseDir();
}
