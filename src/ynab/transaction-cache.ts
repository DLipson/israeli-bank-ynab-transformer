import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAppConfigDir } from "../env.js";
import { ynabRequest } from "./import-service.js";
import type { YnabTransaction } from "./categorize.js";

/**
 * Local copy of all YNAB transactions for one budget, kept current with YNAB delta requests:
 * the first load downloads everything, later loads ask only for changes since `serverKnowledge`.
 * ponytail: one JSON file per budget; move to SQLite when the core engine needs queries.
 */
interface CacheFile {
  serverKnowledge: number;
  transactions: YnabTransaction[];
}

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

export async function getAllTransactions(token: string, budgetId: string): Promise<YnabTransaction[]> {
  const path = cachePath(budgetId);
  const cache: CacheFile | null = existsSync(path) ? (JSON.parse(readFileSync(path, "utf-8")) as CacheFile) : null;

  // Without since_date YNAB returns only the last year, so the first download asks for everything.
  const query = cache ? `?last_knowledge_of_server=${cache.serverKnowledge}` : "?since_date=2000-01-01";
  const data = await ynabRequest<{ transactions: YnabTransaction[]; server_knowledge: number }>(
    token,
    `/budgets/${encodeURIComponent(budgetId)}/transactions${query}`
  );

  const transactions = mergeDelta(cache?.transactions ?? [], data.transactions);
  if (!cache || data.transactions.length > 0 || data.server_knowledge !== cache.serverKnowledge) {
    mkdirSync(join(getAppConfigDir(), "ynab-cache"), { recursive: true });
    writeFileSync(path, JSON.stringify({ serverKnowledge: data.server_knowledge, transactions } satisfies CacheFile), "utf-8");
  }
  return transactions;
}
