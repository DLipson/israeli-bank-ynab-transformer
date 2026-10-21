import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAppConfigDir } from "../env.js";
import { ynabRequest, ynabWrites } from "./import-service.js";
import type { YnabTransaction } from "./categorize.js";

/**
 * Local copy of all YNAB transactions for one budget. The first load downloads everything;
 * later loads use deltas. The first read after a server start, and Refresh, also replace the
 * current and previous month from a full snapshot.
 * ponytail: one JSON file per budget; move to SQLite when the core engine needs queries.
 */
interface CacheFile {
  serverKnowledge: number;
  transactions: YnabTransaction[];
}

/** Budgets that had a snapshot of the last 2 months since this server started. */
const snapshotted = new Set<string>();

function cachePath(budgetId: string): string {
  return join(getAppConfigDir(), "ynab-cache", `${budgetId.replace(/[^\w-]/g, "")}.json`);
}

/** Apply a delta: changed transactions replace the cached copy, deleted ones are removed. */
export function mergeDelta(cached: YnabTransaction[], delta: YnabTransaction[]): YnabTransaction[] {
  const byId = new Map(cached.map((t) => [t.id, t]));
  for (const t of delta) {
    if (t.deleted) byId.delete(t.id);
    else byId.set(t.id, t);
  }
  return [...byId.values()];
}

/** Replace cached transactions from a date onward with a current snapshot. */
export function replaceSinceDate(
  cached: YnabTransaction[],
  snapshot: YnabTransaction[],
  sinceDate: string
): YnabTransaction[] {
  return [...cached.filter((t) => t.date < sinceDate), ...snapshot.filter((t) => !t.deleted)];
}

/** The last read, shared by every caller for a minute (and while it runs), until this server writes to YNAB. */
let shared: { budgetId: string; at: number; writes: number; read: Promise<YnabTransaction[]> } | null = null;
const SHARE_MS = 60_000;

/** `fresh`: read YNAB even when a recent read could be shared (the Refresh button). */
export async function getAllTransactions(token: string, budgetId: string, options: { fresh?: boolean } = {}): Promise<YnabTransaction[]> {
  if (!options.fresh && shared && shared.budgetId === budgetId && shared.writes === ynabWrites() && Date.now() - shared.at < SHARE_MS) {
    return shared.read;
  }
  const entry = { budgetId, at: Date.now(), writes: ynabWrites(), read: readTransactions(token, budgetId, options.fresh) };
  shared = entry;
  entry.read.catch(() => {
    if (shared === entry) shared = null;
  });
  return entry.read;
}

async function readTransactions(token: string, budgetId: string, fresh = false): Promise<YnabTransaction[]> {
  const path = cachePath(budgetId);
  const raw = existsSync(path) ? readFileSync(path, "utf-8") : null;
  const cache: CacheFile | null = raw === null ? null : (JSON.parse(raw) as CacheFile);

  // Without since_date YNAB returns only the last year, so the first download asks for everything.
  const query = cache ? `?last_knowledge_of_server=${cache.serverKnowledge}` : "?since_date=2000-01-01";
  const data = await ynabRequest<{ transactions: YnabTransaction[]; server_knowledge: number }>(
    token,
    `/budgets/${encodeURIComponent(budgetId)}/transactions${query}`,
    { fresh }
  );

  let transactions = mergeDelta(cache?.transactions ?? [], data.transactions);
  if (cache && (fresh || !snapshotted.has(budgetId))) {
    // shortcut: reconcile current and previous month only; widen if older deletions affect history.
    const date = new Date();
    const refreshFrom = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)
    )
      .toISOString()
      .slice(0, 10);
    const recent = await ynabRequest<{ transactions: YnabTransaction[] }>(
      token,
      `/budgets/${encodeURIComponent(budgetId)}/transactions?since_date=${refreshFrom}`,
      { fresh }
    );
    transactions = replaceSinceDate(transactions, recent.transactions, refreshFrom);
  }
  // A full download already is a snapshot.
  snapshotted.add(budgetId);
  const text = JSON.stringify({ serverKnowledge: data.server_knowledge, transactions } satisfies CacheFile);
  if (text !== raw) {
    mkdirSync(join(getAppConfigDir(), "ynab-cache"), { recursive: true });
    writeFileSync(path, text, "utf-8");
  }
  return transactions;
}
