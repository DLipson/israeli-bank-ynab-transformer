import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureAppConfigDirExists, getAppConfigDir } from "../env.js";
import { loadYnabImportConfig, ynabRequest } from "../ynab/import-service.js";
import { getAllTransactions } from "../ynab/transaction-cache.js";
import {
  creditExposure,
  DEFAULT_SETTINGS,
  leftCashflow,
  leftYnab,
  obligations,
  periodEndDate,
  spendingCategories,
  suggestScheduled,
  type Account,
  type Month,
  type ScheduledTransaction,
  type Settings,
  type Snapshot,
} from "./safe-spending.js";
import { baseline, spendItems } from "./baseline.js";

function settingsPath(): string {
  return join(getAppConfigDir(), "safe-spending.json");
}

export function loadSettings(): Settings {
  const path = settingsPath();
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(path, "utf-8")) as Partial<Settings>) };
}

export function saveSettings(settings: Settings): void {
  ensureAppConfigDirExists();
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf-8");
}

/**
 * First-run guess for the overdraft: the open checking account named like "Credit Limit" holds the
 * limit, and the most overdrawn checking account uses it. Shown in the UI so the user can change it.
 */
function guessOverdraft(accounts: Account[]): Settings["overdraft"] {
  const open = accounts.filter((a) => a.type === "checking" && !a.closed && !a.deleted);
  const limit = open.find((a) => /credit limit|מסגרת/i.test(a.name));
  const used = open.filter((a) => a.id !== limit?.id).sort((a, b) => a.balance - b.balance)[0];
  return limit && used && used.balance < 0 ? { limitAccountId: limit.id, accountId: used.id } : null;
}

function budgetPath(): string {
  const id = loadYnabImportConfig().budgetId;
  if (!id) throw new Error("No YNAB budget selected. Choose one in the YNAB tab.");
  return `/budgets/${encodeURIComponent(id)}`;
}

/** The newest imported transaction up to today: how fresh the bank data is. */
export function dataAsOf(transactions: { date: string; import_id?: string | null; deleted: boolean }[], today: string): string {
  let newest = "";
  for (const t of transactions) if (!t.deleted && t.import_id && t.date <= today && t.date > newest) newest = t.date;
  return newest || today;
}

export async function getSpending(token: string, today = new Date().toISOString().slice(0, 10)) {
  const budget = budgetPath();
  const [{ accounts }, { month }, { scheduled_transactions: scheduled }, transactions] = await Promise.all([
    ynabRequest<{ accounts: Account[] }>(token, `${budget}/accounts`),
    ynabRequest<{ month: Month }>(token, `${budget}/months/current`),
    ynabRequest<{ scheduled_transactions: ScheduledTransaction[] }>(token, `${budget}/scheduled_transactions`),
    getAllTransactions(token, loadYnabImportConfig().budgetId),
  ]);

  const settings = loadSettings();
  if (!settings.overdraft) settings.overdraft = guessOverdraft(accounts);

  const snapshot: Snapshot = { today, accounts, month, transactions, scheduled, settings };
  const cashflow = leftCashflow(snapshot);
  const ynab = leftYnab(snapshot);
  const end = periodEndDate(today, settings.periodEnd);
  const items = spendItems(transactions);
  const spendBaseline = baseline(items, dataAsOf(transactions, today), settings.baselineMonths);

  return {
    today,
    periodEnd: end,
    settings,
    cashflow,
    ynab,
    gap: cashflow.total - ynab.total,
    readyToAssign: month.to_be_budgeted,
    exposure: creditExposure(snapshot),
    obligations: obligations(snapshot),
    suggestions: suggestScheduled(snapshot),
    baseline: spendBaseline,
    scheduledCount: scheduled.filter((s) => !s.deleted).length,
    accounts: accounts
      .filter((a) => a.on_budget && !a.closed && !a.deleted)
      .map(({ id, name, type, balance }) => ({ id, name, type, balance })),
    categories: spendingCategories(month)
      .map(({ id, name, category_group_name }) => ({ id, name, group: category_group_name }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)),
  };
}

export interface NewScheduled {
  accountId: string;
  date: string;
  /** Positive milliunits; saved as an outflow. */
  amount: number;
  payeeName: string;
  categoryId: string | null;
}

/** Creates a monthly scheduled outflow in YNAB. Called only from the user's click. */
export async function createScheduled(token: string, s: NewScheduled): Promise<void> {
  await ynabRequest(token, `${budgetPath()}/scheduled_transactions`, {
    method: "POST",
    body: JSON.stringify({
      scheduled_transaction: {
        account_id: s.accountId,
        date: s.date,
        amount: -Math.abs(s.amount),
        payee_name: s.payeeName.slice(0, 200),
        category_id: s.categoryId,
        frequency: "monthly",
      },
    }),
  });
}

export function ignoreSuggestion(id: string): Settings {
  const settings = loadSettings();
  settings.ignoredSuggestions = [...new Set([...settings.ignoredSuggestions, id])];
  saveSettings(settings);
  return settings;
}
