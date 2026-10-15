import { getRun, listRuns } from "../history.js";
import type { YnabRow } from "../transformer.js";
import { loadYnabImportConfig } from "../ynab/import-service.js";
import { getAllTransactions } from "../ynab/transaction-cache.js";
import { reconcile, type AccountReconcile, type ScrapeRun } from "./reconcile.js";

/** Reconcile all saved scrape runs against YNAB. Read-only. */
export async function getReconcile(token: string): Promise<AccountReconcile[]> {
  const config = loadYnabImportConfig();
  if (!config.budgetId) throw new Error("No YNAB budget selected. Choose one in Setup → YNAB import.");
  const runs: ScrapeRun[] = listRuns().map((s) => {
    const run = getRun(s.id)!;
    return { createdAt: run.createdAt, daysBack: run.settings.daysBack, rows: run.payload.rows as YnabRow[] };
  });
  const ynab = await getAllTransactions(token, config.budgetId);
  return reconcile(runs, ynab, config.mappings);
}
