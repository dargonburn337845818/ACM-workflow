/**
 * WSL 网络辅助：当扩展运行在 WSL（Remote-WSL）时，
 * Windows 侧 Ollama 通常不再监听 WSL 可访问的 127.0.0.1，
 * 需要把 localhost 端点解析成 Windows 宿主机 IP。
 */
import * as fs from 'fs';
import { execFileSync } from 'child_process';

export function isWsl(): boolean {
  return process.platform === 'linux' &&
    (!!process.env.WSL_DISTRO_NAME || fs.existsSync('/mnt/c/Windows/System32/cmd.exe'));
}

export function windowsHostIp(): string | null {
  try {
    const out = execFileSync('ip', ['route', 'show', 'default'], { encoding: 'utf8', timeout: 2000 });
    const m = /default via (\d+\.\d+\.\d+\.\d+)/.exec(out);
    if (m) return m[1];
  } catch {
    /* 继续尝试 resolv.conf */
  }
  try {
    const out = execFileSync('grep', ['nameserver', '/etc/resolv.conf'], { encoding: 'utf8', timeout: 2000 });
    const m = /nameserver\s+(\d+\.\d+\.\d+\.\d+)/.exec(out);
    if (m) return m[1];
  } catch {
    /* 探测失败 */
  }
  return null;
}

/**
 * 在 WSL 里，把“访问 Windows 侧 Ollama”的 127.0.0.1/localhost 端点
 * 替换成 Windows 宿主机 IP。
 * LibreTranslate 代理（/translate）跑在 WSL 内部，保持 127.0.0.1 不变。
 */
export function resolveLocalEndpoint(endpoint: string): string {
  if (!isWsl()) return endpoint;
  try {
    const u = new URL(endpoint);
    const isLocal = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    const isOllama = !/\/translate\/?$/.test(endpoint);
    if (isLocal && isOllama) {
      const host = windowsHostIp();
      if (host) {
        return `http://${host}:${u.port || '11434'}${u.pathname}${u.search || ''}`;
      }
    }
  } catch {
    /* 保持原样 */
  }
  return endpoint;
}
