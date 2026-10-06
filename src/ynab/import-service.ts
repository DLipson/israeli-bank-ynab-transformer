import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { YnabRow } from "../transformer.js";
import { ensureAppConfigDirExists, getYnabImportConfigPath } from "../env.js";

const YNAB_API = "https://api.ynab.com/v1";
const PAYEE_MAX = 200;
const MEMO_MAX = 500;

/** Maps a scraped source label (memo `source`, e.g. "Max - 1234") to a YNAB account id. "" = not mapped. */
export interface YnabImportConfig {
  budgetId: string;
  mappings: Record<string, string>;
}

export interface YnabImportResult {
  imported: number;
  duplicates: number;
  unmapped: string[];
}

export interface YnabNewTransaction {
  account_id: string;
  date: string;
  amount: number;
  payee_name: string;
  memo: string;
  cleared: "cleared";
  approved: false;
  import_id: string;
}

export function loadYnabImportConfig(): YnabImportConfig {
  const path = getYnabImportConfigPath();
  if (!existsSync(path)) return { budgetId: "", mappings: {} };
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<YnabImportConfig>;
  return {
    budgetId: typeof parsed.budgetId === "string" ? parsed.budgetId : "",
    mappings: parsed.mappings && typeof parsed.mappings === "object" ? parsed.mappings : {},
  };
}

export function saveYnabImportConfig(config: YnabImportConfig): void {
  ensureAppConfigDirExists();
  writeFileSync(getYnabImportConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

/** Add sources seen in a scrape as unmapped entries, so the YNAB tab can list them. */
export function recordYnabSources(sources: string[]): void {
  const config = loadYnabImportConfig();
  const added = sources.filter((source) => !(source in config.mappings));
  if (added.length === 0) return;
  for (const source of added) config.mappings[source] = "";
  saveYnabImportConfig(config);
}

export function getRowSource(row: YnabRow): string {
  try {
    const memo = JSON.parse(row.memo) as { source?: unknown };
    if (typeof memo.source === "string" && memo.source) return memo.source;
  } catch {
    // memo is empty or not JSON
  }
  return "unknown";
}

function toMilliunits(row: YnabRow): number {
  return Math.round(((parseFloat(row.inflow) || 0) - (parseFloat(row.outflow) || 0)) * 1000);
}

/**
 * Build YNAB transactions for mapped sources.
 * import_id uses YNAB's own format (YNAB:amount:date:occurrence), so re-imports and
 * overlap with YNAB's linked-account imports are rejected as duplicates.
 */
export function buildYnabTransactions(
  rows: YnabRow[],
  mappings: Record<string, string>
): { transactions: YnabNewTransaction[]; unmapped: string[] } {
  const transactions: YnabNewTransaction[] = [];
  const unmapped = new Set<string>();
  const occurrences = new Map<string, number>();

  for (const row of rows) {
    const source = getRowSource(row);
    const accountId = mappings[source];
    if (!accountId) {
      unmapped.add(source);
      continue;
    }

    const amount = toMilliunits(row);
    const key = `${accountId}:${amount}:${row.date}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);

    transactions.push({
      account_id: accountId,
      date: row.date,
      amount,
      payee_name: row.payee.slice(0, PAYEE_MAX),
      memo: row.memo.slice(0, MEMO_MAX),
      cleared: "cleared",
      approved: false,
      import_id: `YNAB:${amount}:${row.date}:${occurrence}`,
    });
  }

  return { transactions, unmapped: [...unmapped] };
}

export function getYnabToken(): string {
  const token = process.env.YNAB_API_TOKEN?.trim();
  if (!token) throw new Error("YNAB_API_TOKEN is not set.");
  return token;
}

async function ynabRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${YNAB_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { detail?: string };
  };
  if (!response.ok || !body.data) {
    throw new Error(`YNAB request failed (${response.status}): ${body.error?.detail ?? response.statusText}`);
  }
  return body.data;
}

export async function fetchYnabBudgets(token: string): Promise<Array<{ id: string; name: string }>> {
  const data = await ynabRequest<{ budgets: Array<{ id: string; name: string }> }>(token, "/budgets");
  return data.budgets.map(({ id, name }) => ({ id, name }));
}

export async function fetchYnabAccounts(
  token: string,
  budgetId: string
): Promise<Array<{ id: string; name: string }>> {
  const data = await ynabRequest<{
    accounts: Array<{ id: string; name: string; closed: boolean; deleted: boolean }>;
  }>(token, `/budgets/${encodeURIComponent(budgetId)}/accounts`);
  return data.accounts.filter((a) => !a.closed && !a.deleted).map(({ id, name }) => ({ id, name }));
}

export async function importRowsToYnab(
  token: string,
  config: YnabImportConfig,
  rows: YnabRow[]
): Promise<YnabImportResult> {
  if (!config.budgetId) throw new Error("No YNAB budget selected. Choose one in the YNAB tab.");

  const { transactions, unmapped } = buildYnabTransactions(rows, config.mappings);
  if (transactions.length === 0) return { imported: 0, duplicates: 0, unmapped };

  const data = await ynabRequest<{ transaction_ids: string[]; duplicate_import_ids: string[] }>(
    token,
    `/budgets/${encodeURIComponent(config.budgetId)}/transactions`,
    { method: "POST", body: JSON.stringify({ transactions }) }
  );

  return {
    imported: data.transaction_ids.length,
    duplicates: data.duplicate_import_ids.length,
    unmapped,
  };
}
