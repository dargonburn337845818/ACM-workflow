import * as vscode from 'vscode';

/**
 * 硬边墨色工作流（V0.8：移除全部半透明色，杜绝"毛玻璃"效果）：
 * - 所有颜色为实色（无 alpha 通道），背景人物壁纸不被任何模糊/半透明层遮挡
 * - 硬边墨色 token：bg #1A1A1A / panel #2D2D2D / surface #3C3C3C / border #4B4B4B
 *   / fg #E8E0D5 / muted #9A928A，无圆角无蓝色调
 * - 布局走官方设置（可备份/还原）：活动栏沉底、隐藏状态栏、侧边栏居左、
 *   单标签页、隐藏命令中心与布局控制，最大化代码沉浸。
 */

const BACKUP_KEY = 'acmWorkflow.beautifyBackup';
const APP_MARK_KEY = 'acmWorkflow.beautifyApplied';

/** 视窗布局设置（应用前备份原值） */
export const LAYOUT_SETTINGS: Record<string, any> = {
  'workbench.activityBar.location': 'bottom',      // 活动栏沉底，主区域更沉浸
  'workbench.statusBar.visible': false,            // 隐藏状态栏
  'workbench.sideBar.location': 'left',            // 侧边栏居左（用户习惯）
  'workbench.editor.showTabs': 'single',           // 单标签页，减少干扰
  'window.commandCenter': false,                   // 隐藏命令中心
  'workbench.layoutControl.enabled': false,        // 隐藏布局控制按钮
  'window.menuBarVisibility': 'compact',           // 菜单栏折叠
  'editor.minimap.enabled': false                  // 隐藏小地图
};

/** 硬边墨色配色（V0.8：全部实色，无半透明，无 backdrop-filter） */
export const IMMERSIVE_COLORS: Record<string, string> = {
  // 基础
  'editor.background': '#1A1A1A',
  'editor.foreground': '#E8E0D5',
  'editor.lineHighlightBackground': '#242424',
  'editor.selectionBackground': '#3C3C3C',
  'editorCursor.foreground': '#C79A6B',
  'editorLineNumber.foreground': '#4B4B4B',
  'editorLineNumber.activeForeground': '#C79A6B',
  'editorGutter.background': '#1A1A1A',
  'editorIndentGuide.background1': '#2D2D2D',
  // 活动栏（沉底后）
  'activityBar.background': '#1A1A1A',
  'activityBar.foreground': '#E8E0D5',
  'activityBar.activeBorder': '#C79A6B',
  'activityBar.inactiveForeground': '#9A928A',
  'activityBarBadge.background': '#3C3C3C',
  'activityBarBadge.foreground': '#E8E0D5',
  // 侧边栏
  'sideBar.background': '#1A1A1A',
  'sideBar.foreground': '#E8E0D5',
  'sideBar.border': '#4B4B4B',
  'sideBarSectionHeader.background': '#2D2D2D',
  'sideBarSectionHeader.foreground': '#E8E0D5',
  'sideBarTitle.foreground': '#C79A6B',
  // 标题栏
  'titleBar.activeBackground': '#1A1A1A',
  'titleBar.activeForeground': '#E8E0D5',
  'titleBar.inactiveBackground': '#2D2D2D',
  'titleBar.inactiveForeground': '#9A928A',
  // 标签页（single 模式）
  'tab.activeBackground': '#2D2D2D',
  'tab.activeForeground': '#E8E0D5',
  'tab.inactiveBackground': '#1A1A1A',
  'tab.inactiveForeground': '#9A928A',
  'tab.border': '#4B4B4B',
  'tab.activeBorder': '#C79A6B',
  'tab.hoverBackground': '#3C3C3C',
  // 编辑器组
  'editorGroupHeader.tabsBackground': '#1A1A1A',
  'editorGroup.border': '#4B4B4B',
  'editorGroupHeader.border': '#4B4B4B',
  // 状态栏（通常隐藏，兜底）
  'statusBar.background': '#1A1A1A',
  'statusBar.foreground': '#9A928A',
  'statusBar.border': '#4B4B4B',
  'statusBar.noFolderBackground': '#1A1A1A',
  // 面板
  'panel.background': '#1A1A1A',
  'panel.border': '#4B4B4B',
  'panelTitle.activeForeground': '#E8E0D5',
  'panelTitle.inactiveForeground': '#9A928A',
  'panelTitle.activeBorder': '#C79A6B',
  // 输入 / 按钮
  'input.background': '#2D2D2D',
  'input.foreground': '#E8E0D5',
  'input.border': '#4B4B4B',
  'input.placeholderForeground': '#9A928A',
  'button.background': '#3C3C3C',
  'button.foreground': '#E8E0D5',
  'button.hoverBackground': '#4B4B4B',
  'button.secondaryBackground': '#2D2D2D',
  'button.secondaryForeground': '#E8E0D5',
  'button.secondaryHoverBackground': '#3C3C3C',
  'dropdown.background': '#2D2D2D',
  'dropdown.foreground': '#E8E0D5',
  'dropdown.border': '#4B4B4B',
  'checkbox.background': '#2D2D2D',
  'checkbox.border': '#4B4B4B',
  // 列表
  'list.hoverBackground': '#3C3C3C',
  'list.activeSelectionBackground': '#3C3C3C',
  'list.activeSelectionForeground': '#E8E0D5',
  'list.focusBackground': '#3C3C3C',
  'list.focusForeground': '#E8E0D5',
  'list.highlightForeground': '#C79A6B',
  'list.inactiveSelectionBackground': '#2D2D2D',
  // 焦点 / 徽章 / 图标
  'focusBorder': '#4B4B4B',
  'badge.background': '#3C3C3C',
  'badge.foreground': '#E8E0D5',
  'icon.foreground': '#E8E0D5',
  // 浮层
  'breadcrumb.background': '#1A1A1A',
  'commandCenter.background': '#2D2D2D',
  'commandCenter.activeBackground': '#3C3C3C',
  'commandCenter.border': '#4B4B4B',
  'editorWidget.background': '#2D2D2D',
  'editorWidget.border': '#4B4B4B',
  'quickInput.background': '#2D2D2D',
  'quickInput.foreground': '#E8E0D5',
  'quickInputList.focusBackground': '#3C3C3C',
  'menu.background': '#2D2D2D',
  'menu.foreground': '#E8E0D5',
  'menu.selectionBackground': '#3C3C3C',
  'notificationCenterHeader.background': '#2D2D2D',
  'notifications.background': '#2D2D2D',
  'notifications.foreground': '#E8E0D5',
  'notifications.border': '#4B4B4B',
  'editorHoverWidget.background': '#2D2D2D',
  'editorHoverWidget.border': '#4B4B4B',
  // 滚动条
  'scrollbarSlider.background': '#3C3C3C',
  'scrollbarSlider.hoverBackground': '#4B4B4B',
  'scrollbarSlider.activeBackground': '#4B4B4B',
  // 终端
  'terminal.background': '#1A1A1A',
  'terminal.foreground': '#E8E0D5',
  'terminal.ansiBlue': '#8A9BB8',
  'terminal.ansiCyan': '#7FA8B8',
  'terminal.ansiMagenta': '#B08AB8',
  'terminal.ansiGreen': '#8B9A6B',
  'terminal.ansiRed': '#C25E5E',
  'terminal.ansiYellow': '#C79A6B',
  'debugToolBar.background': '#2D2D2D',
  // 空白区
  'editorGroup.emptyBackground': '#1A1A1A',
  'minimap.background': '#1A1A1A'
};

async function applyLayoutSettings(context: vscode.ExtensionContext) {
  const backup: Record<string, any> = {};
  for (const key of Object.keys(LAYOUT_SETTINGS)) {
    const parts = key.split('.');
    const section = parts[0];
    const cfg = vscode.workspace.getConfiguration(section);
    backup[key] = cfg.get(parts.slice(1).join('.'));
    await cfg.update(parts.slice(1).join('.'), LAYOUT_SETTINGS[key], vscode.ConfigurationTarget.Global);
  }
  return backup;
}

/** 应用硬边墨色工作流（布局 + 实色配色，自动备份） */
export async function applyImmersiveBeautify(context: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration('workbench');
  const currentColors = cfg.get<Record<string, string>>('colorCustomizations') || {};
  if (!context.globalState.get(APP_MARK_KEY)) {
    const layoutBackup = await applyLayoutSettings(context);
    await context.globalState.update(BACKUP_KEY, { colors: currentColors, layout: layoutBackup });
    await context.globalState.update(APP_MARK_KEY, true);
  }
  const merged = { ...currentColors, ...IMMERSIVE_COLORS };
  await cfg.update('colorCustomizations', merged, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage('硬边墨色工作流已应用：布局重构 + 实色配色（无毛玻璃）。建议重启窗口查看完整效果。');
}

/** 还原布局与配色 */
export async function restoreImmersiveBeautify(context: vscode.ExtensionContext) {
  const backup = context.globalState.get<{ colors?: Record<string, string>; layout?: Record<string, any> }>(BACKUP_KEY);
  const cfg = vscode.workspace.getConfiguration('workbench');
  if (backup?.colors !== undefined) {
    // 有备份：整表还原为用户美化前的配色
    await cfg.update('colorCustomizations', backup.colors, vscode.ConfigurationTarget.Global);
  } else {
    // 无备份（未应用过/状态被清）：只摘除本扩展写入的键，绝不误删用户自己的配色
    const current = cfg.get<Record<string, string>>('colorCustomizations') || {};
    const merged: Record<string, string> = { ...current };
    for (const key of Object.keys(IMMERSIVE_COLORS)) {
      delete merged[key];
    }
    const touched = Object.keys(merged).length !== Object.keys(current).length;
    await cfg.update('colorCustomizations', touched ? merged : undefined, vscode.ConfigurationTarget.Global);
  }
  if (backup?.layout) {
    for (const key of Object.keys(backup.layout)) {
      const parts = key.split('.');
      await vscode.workspace.getConfiguration(parts[0])
        .update(parts.slice(1).join('.'), backup.layout[key], vscode.ConfigurationTarget.Global);
    }
  }
  await context.globalState.update(APP_MARK_KEY, undefined);
  vscode.window.showInformationMessage('已还原硬边墨色美化前的布局与配色。');
}
