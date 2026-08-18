import * as vscode from 'vscode';
import { WorkbenchSidebarProvider } from './core/workbench';
import { startCompanionServer } from './services/companionServer';
import { applyImmersiveBeautify, restoreImmersiveBeautify } from './services/beautify';
import { trace } from './services/diagnostics';
import { runSetupGuide } from './services/setupGuide';

/**
 * ACM Workflow 扩展入口。
 * 职责仅限：激活生命周期 + 命令注册；全部业务逻辑下沉到
 * src/core/（工作台宿主）、src/features/（功能模块）、src/services/（通用服务）。
 */

/** 注册命令并自动写入操作轨迹；异步命令在成功/失败时分别记录结果。 */
function registerTracedCommand(
  context: vscode.ExtensionContext,
  command: string,
  handler: (...args: any[]) => any,
  name = command
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(command, (...args: any[]) => {
      trace('command', name, 'start');
      try {
        const result = handler(...args);
        if (result && typeof (result as Promise<any>).then === 'function') {
          return (result as Promise<any>).then(
            (value) => {
              trace('command', name, 'ok');
              return value;
            },
            (error: any) => {
              trace('command', name, `fail: ${error?.message || error}`);
              throw error;
            }
          );
        }
        trace('command', name, 'ok');
        return result;
      } catch (error: any) {
        trace('command', name, `fail: ${error?.message || error}`);
        throw error;
      }
    })
  );
}

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
  registerTracedCommand(context, 'acmWorkflow.open', () => {
    vscode.commands.executeCommand('acmWorkflow.workbench.focus');
  });
  registerTracedCommand(context, 'acmWorkflow.pickProblem', () => {
    vscode.commands.executeCommand('acmWorkflow.workbench.focus');
  });

  // 对当前打开的题目文件重新抓取测试数据并写回 .prob
  registerTracedCommand(context, 'acmWorkflow.refreshTests', () => {
    WorkbenchSidebarProvider.refreshTests();
  });

  // 批量遍历所有已生成题目，抓取测试数据并写回 .prob
  registerTracedCommand(context, 'acmWorkflow.backfillAllTests', () => {
    WorkbenchSidebarProvider.backfillAllTests();
  });

  // 工作流诊断（环境 / 网络 / 操作轨迹 / 已知 Bug 检查）
  registerTracedCommand(context, 'acmWorkflow.diagnose', () => {
    return provider.diagnose();
  });

  // 环境配置引导：检查本地翻译模型等依赖，缺失时询问安装
  registerTracedCommand(context, 'acmWorkflow.setupGuide', () => {
    return runSetupGuide(context);
  });

  // 沉浸式美化（硬边墨色配色，无毛玻璃/半透明）：应用 / 还原
  registerTracedCommand(context, 'acmWorkflow.beautify', () => {
    applyImmersiveBeautify(context);
  });
  registerTracedCommand(context, 'acmWorkflow.beautifyRestore', () => {
    restoreImmersiveBeautify(context);
  });

  // 启动 competitive-companion 接收服务（浏览器推送题目 → 自动创建文件，CF 专用）
  const companionPort = vscode.workspace.getConfiguration('acmWorkflow').get<number>('companionPort', 27121);
  const companionServer = startCompanionServer(companionPort);
  context.subscriptions.push({ dispose: () => companionServer.close() });

  // 启动后自动打开工作台（侧边栏），省去手动找命令的步骤
  setTimeout(() => {
    vscode.commands.executeCommand('acmWorkflow.workbench.focus');
  }, 300);
}

export function deactivate() {}
