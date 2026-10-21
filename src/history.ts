import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHistoryDir } from "./env.js";

const RETENTION_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Run ids are Date.now() values, so they sort by time and cannot contain path characters.
const RUN_ID_PATTERN = /^\d+$/;

export interface RunAccountResult {
  accountName: string;
  success: boolean;
  transactionCount: number;
  error?: string;
}

export interface RunRecord {
  id: string;
  createdAt: string;
  settings: { daysBack: number; accounts: string[] };
  accounts: RunAccountResult[];
  /** The same payload the GUI receives at the end of a scrape. */
  payload: {
    rows: unknown[];
    skipped: unknown[];
    summary: { byAccount: Record<string, { count: number }>; totalOutflow: number; totalInflow: number };
    auditLog: unknown;
  };
  exports: Array<{ at: string; csvPaths: string[]; auditLogPath: string }>;
  ynabImports: Array<{ at: string; imported: number; duplicates: number; unmapped: string[] }>;
}

export type RunSummary = Omit<RunRecord, "payload"> & {
  rowCount: number;
  totalOutflow: number;
  totalInflow: number;
};

function runPath(id: string): string {
  if (!RUN_ID_PATTERN.test(id)) throw new Error(`Invalid run id: ${id}`);
  return join(getHistoryDir(), `${id}.json`);
}

function writeRun(record: RunRecord): void {
  writeFileSync(runPath(record.id), JSON.stringify(record), "utf-8");
}

export function pruneRuns(now: number = Date.now()): void {
  const dir = getHistoryDir();
  if (!existsSync(dir)) return;
  const cutoff = now - RETENTION_DAYS * MS_PER_DAY;
  for (const file of readdirSync(dir)) {
    const id = file.replace(/\.json$/, "");
    if (RUN_ID_PATTERN.test(id) && Number(id) < cutoff) {
      unlinkSync(join(dir, file));
      parsedRuns.delete(join(dir, file));
    }
  }
}

export function saveRun(input: Pick<RunRecord, "settings" | "accounts" | "payload">, now: number = Date.now()): string {
  mkdirSync(getHistoryDir(), { recursive: true });
  pruneRuns(now);
  const record: RunRecord = {
    id: String(now),
    createdAt: new Date(now).toISOString(),
    ...input,
    exports: [],
    ynabImports: [],
  };
  writeRun(record);
  return record.id;
}

export function getRun(id: string): RunRecord | null {
  const path = runPath(id);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf-8")) as RunRecord) : null;
}

/** Only what the callers need: the summary and the rows (not skipped rows or the audit log). */
const parsedRuns = new Map<string, { mtimeMs: number; size: number; summary: RunSummary; rows: unknown[] }>();

/** Read-only: callers must not change the result. Parsed once; parsed again only when the file changes. */
export function readRunSummaryCached(id: string): { summary: RunSummary; rows: unknown[] } | null {
  const path = runPath(id);
  let stat;
  try {
    stat = statSync(path);
  } catch {
    parsedRuns.delete(path);
    return null;
  }
  const hit = parsedRuns.get(path);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit;
  const { payload, ...rest } = JSON.parse(readFileSync(path, "utf-8")) as RunRecord;
  const summary: RunSummary = {
    ...rest,
    rowCount: payload.rows.length,
    totalOutflow: payload.summary.totalOutflow,
    totalInflow: payload.summary.totalInflow,
  };
  const entry = { mtimeMs: stat.mtimeMs, size: stat.size, summary, rows: payload.rows };
  parsedRuns.set(path, entry);
  return entry;
}

export function updateRun(id: string, update: (record: RunRecord) => void): void {
  const record = getRun(id);
  if (!record) return;
  update(record);
  writeRun(record);
}

/** Newest first. ponytail: files are parsed once and reused until they change. */
export function listRuns(): RunSummary[] {
  const dir = getHistoryDir();
  if (!existsSync(dir)) return [];
  const ids = readdirSync(dir)
    .map((file) => file.replace(/\.json$/, ""))
    .filter((id) => RUN_ID_PATTERN.test(id))
    .sort((a, b) => Number(b) - Number(a));
  // Forget runs whose file is gone, so the cache cannot hold deleted runs.
  const listed = new Set(ids.map((id) => runPath(id)));
  for (const path of parsedRuns.keys()) if (!listed.has(path)) parsedRuns.delete(path);
  return ids.map((id) => readRunSummaryCached(id)!.summary);
}
