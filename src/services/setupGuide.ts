/**
 * ACM Workflow 环境配置引导（V0.19.5）
 *
 * 职责：
 *  - 检查本地翻译服务/模型是否可用；
 *  - 如果 local 后端缺少模型或服务未启动，询问用户是否安装；
 *  - 提供可用的国内镜像链接，失败时把具体原因展示出来，方便用户直接问 AI。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { getFetchDispatcher } from './fetchers/codeforces';

export interface LocalTranslationStatus {
  ok: boolean;
  reason: string;
  provider: string;
  endpoint: string;
}

const MIRROR_LINES = [
  'PyPI 镜像: https://pypi.tuna.tsinghua.edu.cn/simple',
  'Argos 模型（直连）: https://argos-net.com/v1/translate-en_zh-1_9.argosmodel',
  'Argos 模型（镜像1）: https://ghproxy.net/https://github.com/argosopentech/argos-models/raw/master/translate-en_zh-1_9.argosmodel',
  'Argos 模型（镜像2）: https://ghfast.top/https://github.com/argosopentech/argos-models/raw/master/translate-en_zh-1_9.argosmodel',
  'MiniSBD en.onnx（直连）: https://github.com/LibreTranslate/MiniSBD/releases/download/v0.0.1/en.onnx',
  'MiniSBD en.onnx（镜像1）: https://ghproxy.net/https://github.com/LibreTranslate/MiniSBD/releases/download/v0.0.1/en.onnx',
  'MiniSBD en.onnx（镜像2）: https://ghfast.top/https://github.com/LibreTranslate/MiniSBD/releases/download/v0.0.1/en.onnx'
];

/** 检查当前 local 翻译后端是否真的可用（服务 + en->zh 模型）。 */
export async function checkLocalTranslationStatus(): Promise<LocalTranslationStatus> {
  let provider = 'auto';
  try {
    provider = vscode.workspace.getConfiguration('acmWorkflow').get<string>('translateProvider', 'auto') || 'auto';
  } catch { /* 单测环境 */ }

  let endpoint = 'http://127.0.0.1:5000/translate';
  try {
    endpoint = vscode.workspace.getConfiguration('acmWorkflow').get<string>('localEndpoint', endpoint) || endpoint;
  } catch { /* 单测环境 */ }

  if (provider !== 'local') {
    return { ok: true, reason: `当前后端为 ${provider}，不需要本地翻译模型`, provider, endpoint };
  }

  const probeUrl = endpoint.replace(/\/+$/, '').replace(/\/translate$/, '') + '/languages';
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
    if (!Array.isArray(data)) {
      return { ok: false, reason: `本地 /languages 返回格式异常，端点：${endpoint}`, provider, endpoint };
    }
    const en = data.find((l: any) => String(l.code || '').toLowerCase() === 'en');
    const hasZh = en && Array.isArray(en.targets) && en.targets.some((t: any) => String(t).toLowerCase() === 'zh');
    if (!hasZh) {
      return { ok: false, reason: '本地服务已启动，但未安装 en -> zh 模型', provider, endpoint };
    }
    return { ok: true, reason: '本地服务与 en -> zh 模型均正常', provider, endpoint };
  } catch (e: any) {
    return { ok: false, reason: `连接本地服务失败：${e?.message || e}`, provider, endpoint };
  }
}

/** 把 Windows 路径转成 WSL 挂载路径（C:\a\b -> /mnt/c/a/b）。 */
function toWslPath(p: string): string | null {
  const m = /^([A-Za-z]):\\(.*)$/.exec(p);
  if (!m) return null;
  return '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/');
}

/** 打开一个终端，给出可直接运行的本地翻译安装命令（带镜像）。 */
export function openSetupTerminal(context: vscode.ExtensionContext): void {
  const script = path.join(context.extensionPath, 'tools', 'setup_local_translate.sh');
  const env = [
    'PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple',
    'ARGOS_MODEL_URL=https://ghfast.top/https://github.com/argosopentech/argos-models/raw/master/translate-en_zh-1_9.argosmodel',
    'MINISBD_EN_URL=https://ghfast.top/https://github.com/LibreTranslate/MiniSBD/releases/download/v0.0.1/en.onnx'
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
    message: '正在准备安装本地翻译模型（使用国内镜像）…'
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

  const detail = `${status.reason}\n\n可用的镜像链接：\n${MIRROR_LINES.join('\n')}`;
  const choice = await vscode.window.showWarningMessage(
    `ACM Workflow 本地翻译不可用：${status.reason}\n\n是否安装/修复本地翻译模型？`,
    { modal: true },
    '安装本地翻译模型',
    '改用在线翻译 auto',
    '查看原因/镜像'
  );

  if (choice === '安装本地翻译模型') {
    openSetupTerminal(context);
  } else if (choice === '改用在线翻译 auto') {
    await vscode.workspace.getConfiguration('acmWorkflow').update('translateProvider', 'auto', vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('已切换为 auto（MyMemory + Google 兜底），无需本地模型。');
  } else if (choice === '查看原因/镜像') {
    vscode.window.showInformationMessage(detail, { modal: true });
  }
}
