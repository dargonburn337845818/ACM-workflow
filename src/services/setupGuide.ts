/**
 * ACM Workflow 环境配置引导（V0.19.5）
 *
 * 职责：
 *  - 检查本地翻译服务/模型是否可用；
 *  - 如果 local 后端缺少模型或服务未启动，询问用户是否安装；
 *  - 提供 llama.cpp/hy-mt2:latest 的检查与启动帮助，失败时把具体原因展示出来，方便用户直接问 AI。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { getFetchDispatcher } from './fetchers/codeforces';
import { resolveLocalEndpoint } from '../utils/wsl';

export interface LocalTranslationStatus {
  ok: boolean;
  reason: string;
  provider: string;
  endpoint: string;
}

const MIRROR_LINES = [
  '模型文件: D:\\llama\\Hy-MT2-1.8B-Q6_K.gguf',
  '启动服务: D:\\llama\\llama-server.exe -m D:\\llama\\Hy-MT2-1.8B-Q6_K.gguf --host 0.0.0.0 --port 11434 --ctx-size 4096 --no-webui --jinja --alias hy-mt2:latest',
  '自动检查: bash tools/setup_local_translate.sh'
];

/** 检查当前 local 翻译后端是否真的可用（服务 + en->zh 模型）。 */
export async function checkLocalTranslationStatus(): Promise<LocalTranslationStatus> {
  let provider = 'auto';
  try {
    provider = vscode.workspace.getConfiguration('acmWorkflow').get<string>('translateProvider', 'auto') || 'auto';
  } catch { /* 单测环境 */ }

  let endpoint = 'http://127.0.0.1:11434';
  try {
    endpoint = vscode.workspace.getConfiguration('acmWorkflow').get<string>('localEndpoint', endpoint) || endpoint;
  } catch { /* 单测环境 */ }

  if (provider !== 'local') {
    return { ok: true, reason: `当前后端为 ${provider}，不需要本地翻译模型`, provider, endpoint };
  }

  const isDirectApi = !/\/translate\/?$/.test(endpoint);
  const effectiveEndpoint = resolveLocalEndpoint(endpoint);
  const base = effectiveEndpoint.replace(/\/+$/, '');
  const probeUrl = isDirectApi
    ? (base.endsWith('/v1') ? base : base + '/v1') + '/models'
    : base.replace(/\/translate$/, '') + '/languages';
  try {
    const dispatcher = getFetchDispatcher();
    const res = await fetch(probeUrl, {
      headers: { 'User-Agent': 'ACM-Workflow-SetupGuide' },
      signal: AbortSignal.timeout(2500),
      ...(dispatcher ? { dispatcher } : {})
    } as any);
    if (!res.ok) {
      return { ok: false, reason: `本地服务返回 HTTP ${res.status}，端点：${endpoint}`, provider, endpoint };
    }
    const data: any = await res.json().catch(() => null);
    if (isDirectApi) {
      const models = data?.data || [];
      const has = models.some((m: any) => String(m?.id || '') === 'hy-mt2:latest');
      if (!has) {
        return { ok: false, reason: 'llama-server 已连接，但未找到 hy-mt2:latest 模型别名', provider, endpoint };
      }
      return { ok: true, reason: '本地 llama.cpp hy-mt2:latest 翻译服务正常', provider, endpoint };
    }
    if (!Array.isArray(data)) {
      return { ok: false, reason: `本地 /languages 返回格式异常，端点：${endpoint}`, provider, endpoint };
    }
    const en = data.find((l: any) => String(l.code || '').toLowerCase() === 'en');
    const hasZh = en && Array.isArray(en.targets) && en.targets.some((t: any) => String(t).toLowerCase() === 'zh');
    if (!hasZh) {
      return { ok: false, reason: '本地服务已启动，但未找到 llama.cpp hy-mt2:latest 模型', provider, endpoint };
    }
    return { ok: true, reason: '本地 llama.cpp hy-mt2:latest 翻译服务正常', provider, endpoint };
  } catch (e: any) {
    return { ok: false, reason: `连接本地服务失败：${e?.message || e}`, provider, endpoint };
  }
}

/** 把 Windows 路径转成 WSL 路径：支持 C:\a\b -> /mnt/c/a/b，以及 \\wsl.localhost\Distro\... -> /... */
function toWslPath(p: string): string | null {
  const drive = /^([A-Za-z]):\\(.*)$/.exec(p);
  if (drive) {
    return '/mnt/' + drive[1].toLowerCase() + '/' + drive[2].replace(/\\/g, '/');
  }
  const unc = /^\\\\wsl(?:\.localhost|\$)\\+[^\\]+\\(.*)$/i.exec(p);
  if (unc) {
    return '/' + unc[1].replace(/\\/g, '/');
  }
  return null;
}

/** 打开一个终端，给出可直接运行的本地翻译检查/安装命令。 */
export function openSetupTerminal(context: vscode.ExtensionContext): void {
  const script = path.join(context.extensionPath, 'tools', 'setup_local_translate.sh');
  const env = [
    'LLAMA_MODEL_ALIAS=hy-mt2:latest'
  ].join(' ');

  let cmd: string;
  if (process.platform === 'win32') {
    const wslScript = toWslPath(script);
    cmd = wslScript
      ? `wsl.exe bash -lc "${env} bash '${wslScript}'"`
      : `bash -lc "${env} bash '${script}'"`;
  } else {
    cmd = `bash -lc "${env} bash '${script}'"`;
  }

  const terminal = vscode.window.createTerminal({
    name: 'ACM Workflow 本地翻译安装',
    message: '正在准备检查/启动本地 llama.cpp 翻译模型…'
  });
  terminal.show();
  terminal.sendText(cmd);
}

/** 环境配置引导入口：检查 local 翻译，缺失时询问用户。 */
export async function runSetupGuide(context: vscode.ExtensionContext): Promise<void> {
  const status = await checkLocalTranslationStatus();
  if (status.ok) {
    vscode.window.showInformationMessage(`ACM Workflow 环境检查：${status.reason}`);
    return;
  }

  const detail = `${status.reason}\n\n可用的帮助信息：\n${MIRROR_LINES.join('\n')}`;
  const choice = await vscode.window.showWarningMessage(
    `ACM Workflow 本地翻译不可用：${status.reason}\n\n是否安装/修复本地翻译模型？`,
    { modal: true },
    '安装本地翻译模型',
    '改用在线翻译 auto',
    '查看原因/帮助'
  );

  if (choice === '安装本地翻译模型') {
    openSetupTerminal(context);
  } else if (choice === '改用在线翻译 auto') {
    await vscode.workspace.getConfiguration('acmWorkflow').update('translateProvider', 'auto', vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('已切换为 auto（MyMemory + Google 兜底），无需本地模型。');
  } else if (choice === '查看原因/帮助') {
    vscode.window.showInformationMessage(detail, { modal: true });
  }
}
