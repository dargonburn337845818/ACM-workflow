import * as vscode from 'vscode';
import { WorkbenchSidebarProvider } from './core/workbench';
import { createServices, Services } from './services';

/**
 * ACM Workflow 扩展入口。
 * 职责仅限：激活生命周期 + 命令注册；全部业务逻辑下沉到
 * src/core/（工作台宿主）、src/services/（通用服务门面）。
 */

/** 注册命令并自动写入操作轨迹；异步命令在成功/失败时分别记录结果。 */
function registerTracedCommand(
  context: vscode.ExtensionContext,
  services: Services,
  command: string,
  handler: (...args: any[]) => any,
  name = command
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(command, (...args: any[]) => {
      services.support.trace('command', name, 'start');
      try {
        const result = handler(...args);
        if (result && typeof (result as Promise<any>).then === 'function') {
          return (result as Promise<any>).then(
            (value) => {
              services.support.trace('command', name, 'ok');
              return value;
            },
            (error: any) => {
              services.support.trace('command', name, `fail: ${error?.message || error}`);
              throw error;
            }
          );
        }
        services.support.trace('command', name, 'ok');
        return result;
      } catch (error: any) {
        services.support.trace('command', name, `fail: ${error?.message || error}`);
        throw error;
      }
    })
  );
}

export function activate(context: vscode.ExtensionContext) {
  console.log('[ACM-Workflow] activated');

  // ADR 0003：组合根统一构建服务门面，Workbench 只接收组装好的 Services。
  const services = createServices(context);
  // 确保 VS Code 关闭时停止由扩展拉起的本地 Ollama 翻译服务。
  context.subscriptions.push({ dispose: () => services.support.dispose() });

  // 注册侧边栏视图（活动栏 ACM 图标 → 侧边栏工作台）
  const provider = new WorkbenchSidebarProvider(context.extensionUri, context, services);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WorkbenchSidebarProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // 打开工作台 / 随机选题 = 聚焦侧边栏视图
  registerTracedCommand(context, services, 'acmWorkflow.open', () => {
    vscode.commands.executeCommand('acmWorkflow.workbench.focus');
  });
  registerTracedCommand(context, services, 'acmWorkflow.pickProblem', () => {
    vscode.commands.executeCommand('acmWorkflow.workbench.focus');
  });

  // 对当前打开的题目文件重新抓取测试数据并写回 .prob
  registerTracedCommand(context, services, 'acmWorkflow.refreshTests', () => {
    provider.refreshTestsCommand();
  });

  // 批量遍历所有已生成题目，抓取测试数据并写回 .prob
  registerTracedCommand(context, services, 'acmWorkflow.backfillAllTests', () => {
    provider.backfillAllTestsCommand();
  });

  // 工作流诊断（环境 / 网络 / 操作轨迹 / 已知 Bug 检查）
  registerTracedCommand(context, services, 'acmWorkflow.diagnose', () => {
    return provider.diagnose();
  });

  // 环境配置引导：检查本地翻译模型等依赖，缺失时询问安装
  registerTracedCommand(context, services, 'acmWorkflow.setupGuide', () => {
    return services.support.runSetupGuide();
  });

  // 沉浸式美化（硬边墨色配色，无毛玻璃/半透明）：应用 / 还原
  registerTracedCommand(context, services, 'acmWorkflow.beautify', async () => {
    await services.support.applyBeautify();
  });
  registerTracedCommand(context, services, 'acmWorkflow.beautifyRestore', async () => {
    await services.support.restoreBeautify();
  });

  // 全局壁纸：把当前选中的壁纸写入 caoge5524/vscode-background 插件配置并触发应用
  registerTracedCommand(context, services, 'acmWorkflow.applyGlobalWallpaper', async () => {
    const wallpaperPath = vscode.workspace.getConfiguration('acmWorkflow').get<string>('glassBackground', '');
    if (!wallpaperPath) {
      vscode.window.showWarningMessage('请先在工作台「壁纸」中选择一张壁纸，再设为全局壁纸。');
      return;
    }
    const bgCfg = vscode.workspace.getConfiguration('vscodeBackground');
    await bgCfg.update('enabled', true, vscode.ConfigurationTarget.Global);
    await bgCfg.update('videos', [wallpaperPath], vscode.ConfigurationTarget.Global);
    await bgCfg.update('transitions', ['zoom'], vscode.ConfigurationTarget.Global);
    await bgCfg.update('opacity', 0.8, vscode.ConfigurationTarget.Global);
    await bgCfg.update('switchInterval', 0, vscode.ConfigurationTarget.Global);
    await bgCfg.update('theme', 'glass', vscode.ConfigurationTarget.Global);
    // 触发 caoge5524/vscode-background 的安装命令，让配置立即生效
    try {
      await vscode.commands.executeCommand('vscode-background.install');
    } catch { /* 插件未安装时忽略，稍后提示安装 */ }
    vscode.window.showInformationMessage(
      '已写入 VSCode Background 插件配置。\n\n' +
      '请安装联动插件：https://github.com/caoge5524/vscode-background\n' +
      '安装后按插件提示重启 VSCode 即可显示全局背景。'
    );
  });

  // 启动 competitive-companion 接收服务（浏览器推送题目 → 自动创建文件，CF 专用）
  const companionPort = vscode.workspace.getConfiguration('acmWorkflow').get<number>('companionPort', 27121);
  const companionServer = services.support.startCompanionServer(companionPort);
  context.subscriptions.push({ dispose: () => companionServer.close() });

  // 启动后自动打开工作台（侧边栏），省去手动找命令的步骤
  setTimeout(() => {
    vscode.commands.executeCommand('acmWorkflow.workbench.focus');
  }, 300);
}

export function deactivate() {}
