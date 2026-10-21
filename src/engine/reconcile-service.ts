import { listRuns, readRunSummaryCached } from "../history.js";
import type { YnabRow } from "../transformer.js";
import type { YnabTransaction } from "../ynab/categorize.js";
import { buildYnabTransactions, loadYnabImportConfig, ynabRequest } from "../ynab/import-service.js";
import { getAllTransactions } from "../ynab/transaction-cache.js";
import { missingItems, reconcile, type AccountReconcile, type ScrapeRun } from "./reconcile.js";

function scrapeRuns(): ScrapeRun[] {
  return listRuns().map((s) => {
    const run = readRunSummaryCached(s.id)!;
    return { createdAt: run.summary.createdAt, daysBack: run.summary.settings.daysBack, rows: run.rows as YnabRow[] };
  });
}

/** Reconcile all saved scrape runs against these YNAB transactions. Read-only. */
export function reconcileAgainst(ynab: YnabTransaction[]): AccountReconcile[] {
  return reconcile(scrapeRuns(), ynab, loadYnabImportConfig().mappings);
}

/** Reconcile all saved scrape runs against YNAB. Read-only. */
export async function getReconcile(token: string): Promise<AccountReconcile[]> {
  const config = loadYnabImportConfig();
  if (!config.budgetId) throw new Error("No YNAB budget selected. Choose one in Setup → YNAB import.");
  return reconcileAgainst(await getAllTransactions(token, config.budgetId));
}

/** Transactions this server imported from the Inbox, so Undo can delete only those. */
const importedIds = new Set<string>();

/**
 * Inbox "Import": adds one bank row that YNAB does not have. The client sends only the card id;
 * the row comes from the saved scrapes. Called only from the user's click.
 */
export async function importMissing(token: string, id: string, ignored: string[]): Promise<string> {
  const config = loadYnabImportConfig();
  const ynab = await getAllTransactions(token, config.budgetId);
  const results = reconcileAgainst(ynab);
  const item = missingItems(results, ynab, ignored).find((i) => i.id === id && i.side === "not-in-ynab");
  if (!item) throw new Error("This row is no longer missing from YNAB.");
  const row = results.flatMap((a) => a.missingInYnab).find((b) => b.date === item.date && b.amount === item.amount && b.payee === item.payee)!.row;
  const [transaction] = buildYnabTransactions([row], config.mappings).transactions;
  if (!transaction) throw new Error("This account is not mapped to a YNAB account.");

  const path = `/budgets/${encodeURIComponent(config.budgetId)}/transactions`;
  const post = (t: object) => ynabRequest<{ transaction_ids: string[] }>(token, path, { method: "POST", body: JSON.stringify({ transactions: [t] }) });
  let { transaction_ids: ids } = await post(transaction);
  // YNAB keeps the import_id of a deleted transaction and rejects it again. A row the user deleted
  // and now wants back goes in without one; later scrapes still send the old id, so it is not doubled.
  if (ids.length === 0) ({ transaction_ids: ids } = await post({ ...transaction, import_id: null }));
  if (ids.length === 0) throw new Error("YNAB did not add the transaction.");
  importedIds.add(ids[0]);
  return ids[0];
}

/** Inbox Undo of "Import": deletes the transaction, only if this server imported it. */
export async function deleteImported(token: string, transactionId: string): Promise<void> {
  if (!importedIds.has(transactionId)) throw new Error("Only a transaction imported from the Inbox in this session can be undone.");
  const budget = encodeURIComponent(loadYnabImportConfig().budgetId);
  await ynabRequest(token, `/budgets/${budget}/transactions/${encodeURIComponent(transactionId)}`, { method: "DELETE" });
  importedIds.delete(transactionId);
}
