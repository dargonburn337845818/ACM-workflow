import * as vscode from 'vscode';
import { CodeforcesClient } from './codeforcesClient';
import { StatementService } from './statementService';
import { ProblemWorkspace } from './problemWorkspace';
import { JudgeService } from './judgeService';
import { RecordService } from './recordService';
import { SupportService } from './supportService';
import { SparkService } from './spark';

export { CfSessionError } from './cfSession';
export type { DataGenSpec, DataGenType, DataGenStepSpec } from './dataGen';
export type { CompareMode, CheckerOptions } from './verifier';
export type { DiagnosticRuntime } from './diagnostics';
export type { ProblemRecord } from './records';

/** 组装后的服务门面集合。features 通过 `Pick<Services, ...>` 只拿自己需要的门面。 */
export interface Services {
  codeforces: CodeforcesClient;
  statement: StatementService;
  workspace: ProblemWorkspace;
  judge: JudgeService;
  records: RecordService;
  support: SupportService;
  spark: SparkService;
}

/** 组合根：统一构建并注入所有服务门面。 */
export function createServices(context: vscode.ExtensionContext): Services {
  return {
    codeforces: new CodeforcesClient(context),
    statement: new StatementService(context),
    workspace: new ProblemWorkspace(),
    judge: new JudgeService(),
    records: new RecordService(),
    support: new SupportService(context),
    spark: new SparkService()
  };
}
