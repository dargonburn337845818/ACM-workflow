import * as vscode from 'vscode';
import { WorkbenchSidebarProvider } from './core/workbench';
import { startCompanionServer } from './services/companionServer';
import { applyImmersiveBeautify, restoreImmersiveBeautify } from './services/beautify';

/**
 * ACM Workflow 扩展入口。
 * 职责仅限：激活生命周期 + 命令注册；全部业务逻辑下沉到
 * src/core/（工作台宿主）、src/features/（功能模块）、src/services/（通用服务）。
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('[ACM-Workflow] activated');

  // 注册侧边栏视图（活动栏 ACM 图标 → 侧边栏工作台）
  const provider = new WorkbenchSidebarProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WorkbenchSidebarProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // 打开工作台 / 随机选题 = 聚焦侧边栏视图
  context.subscriptions.push(
    vscode.commands.registerCommand('acmWorkflow.open', () => {
      vscode.commands.executeCommand('acmWorkflow.workbench.focus');
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('acmWorkflow.pickProblem', () => {
      vscode.commands.executeCommand('acmWorkflow.workbench.focus');
    })
  );

  // 对当前打开的题目文件重新抓取测试数据并写回 .prob
  context.subscriptions.push(
    vscode.commands.registerCommand('acmWorkflow.refreshTests', () => {
      WorkbenchSidebarProvider.refreshTests();
    })
  );

  // 批量遍历所有已生成题目，抓取测试数据并写回 .prob
  context.subscriptions.push(
    vscode.commands.registerCommand('acmWorkflow.backfillAllTests', () => {
      WorkbenchSidebarProvider.backfillAllTests();
    })
  );

  // 环境诊断（平台 / PATH / curl / g++），排查抓取失败
  context.subscriptions.push(
    vscode.commands.registerCommand('acmWorkflow.diagnose', () => {
      WorkbenchSidebarProvider.diagnose();
    })
  );

  // 沉浸式美化（硬边墨色配色，无毛玻璃/半透明）：应用 / 还原
  context.subscriptions.push(
    vscode.commands.registerCommand('acmWorkflow.beautify', () => {
      applyImmersiveBeautify(context);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('acmWorkflow.beautifyRestore', () => {
      restoreImmersiveBeautify(context);
    })
  );

  // 启动 competitive-companion 接收服务（浏览器推送题目 → 自动创建文件，洛谷/CF 通用）
  const companionPort = vscode.workspace.getConfiguration('acmWorkflow').get<number>('companionPort', 27121);
  const companionServer = startCompanionServer(companionPort);
  context.subscriptions.push({ dispose: () => companionServer.close() });

  // 启动后自动打开工作台（侧边栏），省去手动找命令的步骤
  setTimeout(() => {
    vscode.commands.executeCommand('acmWorkflow.workbench.focus');
  }, 300);
}

export function deactivate() {}
