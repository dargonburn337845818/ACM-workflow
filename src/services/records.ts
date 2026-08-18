import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { Database } from 'sql.js';
import { Problem } from '../types';
import { resolveDbPath } from '../utils/paths';

/**
 * 刷题记录存储：SQLite（sql.js WASM 实现，无原生编译依赖）。
 * 数据库文件：配置 acmWorkflow.dbPath 指定；留空 → {baseDir}/records.db。
 */

function dbPath(): string {
  return resolveDbPath();
}

export type RecordStatus = 'untouched' | 'trying' | 'ac' | 'abandoned';

export interface ProblemRecord {
  id: string;
  platform: 'codeforces' | 'luogu';
  title: string;
  difficulty?: number;
  url: string;
  status: RecordStatus;
  attempts: number;
  updatedAt: number;
}

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;

/** 旧库迁移：补充沉浸模式新增列（notes / canvas_data） */
function migrate(d: Database) {
  const res = d.exec('PRAGMA table_info(records)');
  if (res.length === 0) return;
  const cols = new Set(res[0].values.map((r) => String(r[1])));
  if (!cols.has('notes')) {
    d.run('ALTER TABLE records ADD COLUMN notes TEXT');
  }
  if (!cols.has('canvas_data')) {
    d.run('ALTER TABLE records ADD COLUMN canvas_data TEXT');
  }
}

/** 核心字段清单（对应 SPEC 八：id/platform/title/rating/status/last_try/notes/canvas_data，
 *  本库命名为 difficulty/updated_at，语义等价）；缺失则重建表，避免旧库结构损坏导致全零/无响应 */
const REQUIRED_COLS = ['id', 'platform', 'title', 'difficulty', 'url', 'status', 'attempts', 'updated_at', 'notes', 'canvas_data'];

/** 校验并修复表结构：缺核心列时重建（数据量小，重建可接受） */
function ensureSchema(d: Database) {
  const res = d.exec('PRAGMA table_info(records)');
  if (res.length === 0) return;
  const cols = new Set(res[0].values.map((r) => String(r[1])));
  const missing = REQUIRED_COLS.filter((c) => !cols.has(c));
  if (missing.length > 0) {
    d.run('DROP TABLE IF EXISTS records');
    d.run(`CREATE TABLE records (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      title TEXT NOT NULL,
      difficulty INTEGER,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'untouched',
      attempts INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      notes TEXT,
      canvas_data TEXT
    )`);
  }
}

async function getDb(): Promise<Database> {
  if (db) return db;
  if (!initPromise) {
    initPromise = (async () => {
      const SQL = await initSqlJs({
        locateFile: (file: string) => path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file)
      });
      // 关键保障：数据库目录不存在时先创建，否则 persist 抛 ENOENT，
      // 整个记录模块初始化失败 → 统计全零、列表为空、按钮"无响应"（静默失败）。
      fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
      let d: Database;
      if (fs.existsSync(dbPath())) {
        d = new SQL.Database(new Uint8Array(fs.readFileSync(dbPath())));
      } else {
        d = new SQL.Database();
        d.run(`CREATE TABLE records (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          title TEXT NOT NULL,
          difficulty INTEGER,
          url TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'untouched',
          attempts INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          notes TEXT,
          canvas_data TEXT
        )`);
      }
      migrate(d);
      ensureSchema(d);
      persist(d);
      db = d;
      return d;
    })();
  }
  return initPromise;
}

function persist(d: Database) {
  const data = d.export();
  fs.writeFileSync(dbPath(), new Uint8Array(data));
}

function rowsToRecords(rows: any[][]): ProblemRecord[] {
  return rows.map((r) => ({
    id: String(r[0]),
    platform: r[1] as ProblemRecord['platform'],
    title: String(r[2]),
    difficulty: r[3] === null || r[3] === undefined ? undefined : Number(r[3]),
    url: String(r[4]),
    status: r[5] as RecordStatus,
    attempts: Number(r[6]),
    updatedAt: Number(r[7])
  }));
}

/** 列出全部记录（按更新时间倒序） */
export async function listRecords(): Promise<ProblemRecord[]> {
  const d = await getDb();
  const res = d.exec(
    'SELECT id, platform, title, difficulty, url, status, attempts, updated_at FROM records ORDER BY updated_at DESC'
  );
  if (res.length === 0) return [];
  return rowsToRecords(res[0].values);
}

/** 记录存在则返回，不存在则插入（untouched） */
export async function ensureRecord(problem: Problem): Promise<ProblemRecord> {
  const d = await getDb();
  const now = Date.now();
  d.run(
    `INSERT OR IGNORE INTO records (id, platform, title, difficulty, url, status, attempts, updated_at)
     VALUES (?, ?, ?, ?, ?, 'untouched', 0, ?)`,
    [problem.id, problem.platform, problem.title, problem.difficulty ?? null, problem.url, now]
  );
  persist(d);
  const res = d.exec(
    'SELECT id, platform, title, difficulty, url, status, attempts, updated_at FROM records WHERE id = ?',
    [problem.id]
  );
  if (res.length === 0) {
    throw new Error('记录写入失败');
  }
  return rowsToRecords(res[0].values)[0];
}

/** 更新记录状态/尝试次数，并刷新 updated_at */
export async function updateRecord(id: string, patch: { status?: RecordStatus; attempts?: number }): Promise<void> {
  const d = await getDb();
  const now = Date.now();
  const sets: string[] = ['updated_at = ?'];
  const params: any[] = [now];
  if (patch.status) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (patch.attempts !== undefined) {
    sets.push('attempts = ?');
    params.push(patch.attempts);
  }
  params.push(id);
  d.run(`UPDATE records SET ${sets.join(', ')} WHERE id = ?`, params);
  persist(d);
}

/** 删除记录 */
export async function removeRecord(id: string): Promise<void> {
  const d = await getDb();
  d.run('DELETE FROM records WHERE id = ?', [id]);
  persist(d);
}

/** 统计信息（总计 / 已AC / 尝试中 / 已放弃 / AC率）——Webview 加载时直接调用，杜绝全零假数据 */
export async function getStats(): Promise<{ total: number; ac: number; trying: number; abandoned: number; rate: string }> {
  const all = await listRecords();
  const ac = all.filter((r) => r.status === 'ac').length;
  const trying = all.filter((r) => r.status === 'trying').length;
  const abandoned = all.filter((r) => r.status === 'abandoned').length;
  return {
    total: all.length,
    ac,
    trying,
    abandoned,
    rate: all.length > 0 ? Math.round((ac / all.length) * 100) + '%' : '–'
  };
}

/** 批量导入（如 CF 历史 AC 记录）：单次事务 + 单次持久化，避免逐条全量写盘。
 *  V0.8：可传入每题的原始 AC 时间 updatedAt（毫秒），否则用当前时间。
 *  修复：历史导入不再统一写"现在"，避免历史 AC 混入今日统计。 */
export async function bulkImport(
  items: { id: string; platform: 'codeforces' | 'luogu'; title: string; difficulty?: number; url: string; status: RecordStatus; attempts?: number; updatedAt?: number }[]
): Promise<number> {
  if (items.length === 0) return 0;
  const d = await getDb();
  const now = Date.now();
  for (const it of items) {
    d.run(
      `INSERT OR IGNORE INTO records (id, platform, title, difficulty, url, status, attempts, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [it.id, it.platform, it.title, it.difficulty ?? null, it.url, it.status, it.attempts ?? 0, it.updatedAt ?? now]
    );
  }
  persist(d);
  return items.length;
}

// ===== 沉浸模式扩展字段（笔记 / 画板） =====

export interface ProblemExtra {
  notes?: string;
  canvasData?: string; // base64 PNG
}

/** 读取某题的笔记与画板数据 */
export async function getExtra(id: string): Promise<ProblemExtra> {
  const d = await getDb();
  const res = d.exec('SELECT notes, canvas_data FROM records WHERE id = ?', [id]);
  if (res.length === 0 || res[0].values.length === 0) {
    return {};
  }
  const row = res[0].values[0];
  return { notes: row[0] == null ? undefined : String(row[0]), canvasData: row[1] == null ? undefined : String(row[1]) };
}

/** 读取某题笔记（无记录/未设置返回 undefined） */
export async function getNote(id: string): Promise<string | undefined> {
  const extra = await getExtra(id);
  return extra.notes;
}

/** 读取某题画板数据（无记录/未设置返回 undefined） */
export async function getCanvas(id: string): Promise<string | undefined> {
  const extra = await getExtra(id);
  return extra.canvasData;
}

/** 保存笔记（Markdown 文本） */
export async function saveNote(id: string, note: string): Promise<void> {
  const d = await getDb();
  d.run('UPDATE records SET notes = ? WHERE id = ?', [note, id]);
  persist(d);
}

/** 保存画板数据（base64 PNG） */
export async function saveCanvas(id: string, data: string): Promise<void> {
  const d = await getDb();
  d.run('UPDATE records SET canvas_data = ? WHERE id = ?', [data, id]);
  persist(d);
}
