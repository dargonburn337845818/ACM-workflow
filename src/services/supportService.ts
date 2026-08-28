import * as vscode from 'vscode';
import * as http from 'http';
import { getBrowserPath } from './browser';
import { applyImmersiveBeautify, restoreImmersiveBeautify } from './beautify';
import { startCompanionServer } from './companionServer';
import {
  collectDiagnosticReport,
  DiagnosticReportData,
  DiagnosticRuntime,
  trace,
  TraceSource,
  writeDiagnosticFiles
} from './diagnostics';
import { runSetupGuide } from './setupGuide';
import { stopLocalServer } from './translate';

/**
 * SupportService facade：封装诊断、环境配置引导、美化、浏览器探测与
 * Competitive Companion 服务等支持性能力。
 */
export class SupportService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  trace(source: TraceSource, name: string, result = 'ok'): void {
    trace(source, name, result);
  }

  collectDiagnosticReport(runtime: DiagnosticRuntime, opts?: { signal?: AbortSignal }): Promise<DiagnosticReportData> {
    return collectDiagnosticReport(runtime, opts);
  }

  writeDiagnosticFiles(dir: string, report: DiagnosticReportData): Promise<{ markdownPath: string; jsonPath: string }> {
    return writeDiagnosticFiles(dir, report);
  }

  runSetupGuide(): Promise<void> {
    return runSetupGuide(this.context);
  }

  applyBeautify(): Promise<void> {
    return applyImmersiveBeautify(this.context);
  }

  restoreBeautify(): Promise<void> {
    return restoreImmersiveBeautify(this.context);
  }

  startCompanionServer(port: number): http.Server {
    return startCompanionServer(port);
  }

  getBrowserPath(): string | null {
    return getBrowserPath();
  }

  /** 释放扩展拉起的本地翻译服务（VS Code 关闭时调用）。 */
  dispose(): void {
    stopLocalServer();
  }
}
