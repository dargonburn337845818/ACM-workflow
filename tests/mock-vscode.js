/**
 * vscode 模块最小 mock（仅冒烟测试使用，不打包）。
 * tests/smoke.js 通过 Module._resolveFilename 劫持 'vscode' 指向本文件。
 */
'use strict';

const registeredCommands = [];
const registeredViews = [];

const config = () => ({
  get: (_key, def) => def,
  update: async () => {},
  has: () => false
});

module.exports = {
  workspace: {
    getConfiguration: config,
    onDidChangeActiveTextEditor: () => ({ dispose() {} })
  },
  window: {
    showInformationMessage: () => {},
    showWarningMessage: () => {},
    showErrorMessage: () => {},
    showInputBox: async () => undefined,
    createOutputChannel: () => ({ appendLine() {}, show() {}, clear() {} }),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    registerWebviewViewProvider: (viewType, provider) => {
      registeredViews.push({ viewType, provider });
      return { dispose() {} };
    }
  },
  env: { openExternal: () => {} },
  Uri: {
    file: (p) => ({ fsPath: p, toString: () => p }),
    parse: (s) => ({ toString: () => s })
  },
  commands: {
    executeCommand: async () => {},
    registerCommand: (command, fn) => {
      registeredCommands.push({ command, fn });
      return { dispose() {} };
    }
  },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  ExtensionContext: class {},
  __registeredCommands: registeredCommands,
  __registeredViews: registeredViews
};
