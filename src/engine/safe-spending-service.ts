import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listRuns, type RunSummary } from "../history.js";
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
  scheduledOutflows,
  spendingCategories,
  suggestScheduled,
  type Account,
  type Month,
  type ScheduledTransaction,
  type Settings,
  settingsFromSaved,
  type Snapshot,
} from "./safe-spending.js";
import { baseline, pastMonths, spendItems } from "./baseline.js";
import { monthlyFlowFor } from "./monthly-flow.js";
import { spentVsIncomeFor } from "./spent-vs-income.js";
import { categoryComparisons, whatPushedOver } from "./category-comparisons.js";
import { cardGroups, watchItems } from "./cards.js";
import { detectAnomalies } from "./anomalies.js";
import { isUncategorized } from "../ynab/categorize.js";

function settingsPath(): string {
  return join(getAppConfigDir(), "safe-spending.json");
}

export function loadSettings(): Settings {
  const path = settingsPath();
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
  const saved = JSON.parse(readFileSync(path, "utf-8")) as NonNullable<Parameters<typeof settingsFromSaved>[0]>;
  const settings = settingsFromSaved(saved);
  if (["periodEnd", "overdraft", "subtractExpected"].some((key) => Object.hasOwn(saved, key))) saveSettings(settings);
  return settings;
}

export function saveSettings(settings: Settings): void {
  ensureAppConfigDirExists();
  writeFileSync(settingsPath(), JSON.stringify(settingsFromSaved(settings), null, 2), "utf-8");
}

function budgetPath(): string {
  const id = loadYnabImportConfig().budgetId;
  if (!id) throw new Error("No YNAB budget selected. Choose one in the YNAB tab.");
  return `/budgets/${encodeURIComponent(id)}`;
}

/** The newest imported transaction up to today, used as the spending pace cutoff. */
export function dataAsOf(transactions: { date: string; import_id?: string | null; deleted: boolean }[], today: string): string {
  let newest = "";
  for (const t of transactions) if (!t.deleted && t.import_id && t.date <= today && t.date > newest) newest = t.date;
  return newest || today;
}

export function lastSuccessfulScrapeAt(runs: Pick<RunSummary, "createdAt" | "accounts">[]): string | null {
  return runs.find((run) => run.accounts.length > 0 && run.accounts.every((account) => account.success))?.createdAt ?? null;
}

type YnabData = [{ accounts: Account[] }, { month: Month }, { scheduled_transactions: ScheduledTransaction[] }, Awaited<ReturnType<typeof getAllTransactions>>];

/** The last YNAB read, so a reload after a settings change does not wait for YNAB again. */
let lastYnab: { budget: string; at: number; data: YnabData } | null = null;
const QUICK_MAX_AGE_MS = 10 * 60_000;

/** `quick`: reuse the last YNAB read (up to 10 minutes old); only the settings changed. */
export async function getSpending(token: string, today = new Date().toISOString().slice(0, 10), options: { quick?: boolean } = {}) {
  const budget = budgetPath();
  const reuse = options.quick && lastYnab?.budget === budget && Date.now() - lastYnab.at < QUICK_MAX_AGE_MS;
  const data: YnabData = reuse
    ? lastYnab!.data
    : await Promise.all([
        ynabRequest<{ accounts: Account[] }>(token, `${budget}/accounts`),
        ynabRequest<{ month: Month }>(token, `${budget}/months/current`),
        ynabRequest<{ scheduled_transactions: ScheduledTransaction[] }>(token, `${budget}/scheduled_transactions`),
        getAllTransactions(token, loadYnabImportConfig().budgetId),
      ]);
  if (!reuse) lastYnab = { budget, at: Date.now(), data };
  const [{ accounts }, { month }, { scheduled_transactions: scheduled }, transactions] = data;

  const settings = loadSettings();
  const lastScrapedAt = lastSuccessfulScrapeAt(listRuns());

  const snapshot: Snapshot = { today, accounts, month, transactions, scheduled, settings };
  const cashflow = leftCashflow(snapshot);
  const cards = cardGroups(snapshot);
  const ynab = leftYnab(snapshot);
  const end = periodEndDate(today, settings.payday);
  const items = spendItems(transactions);
  const asOf = dataAsOf(transactions, today);
  const spendBaseline = baseline(items, asOf, settings.baselineMonths);
  const comparisons = categoryComparisons({
    items,
    transactions,
    today,
    asOf,
    months: settings.baselineMonths,
    essentialCategoryIds: settings.essentialCategoryIds,
    scheduled,
  });
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 31 * 86400000).toISOString().slice(0, 10);

  const monthlyFlow = monthlyFlowFor(transactions, items, month.categories, today, month.activity ?? null);
  const spentVsIncome = {
    ...spentVsIncomeFor(transactions, items, month.categories, accounts, monthlyFlow, today),
    reasons: whatPushedOver(comparisons),
  };
  return {
    today,
    lastScrapedAt,
    periodEnd: end,
    monthlyFlow,
    spentVsIncome,
    available: cashflow,
    cards,
    watch: watchItems(cards, comparisons),
    settings,
    cashflow,
    ynab,
    gap: cashflow.total - ynab.total,
    readyToAssign: month.to_be_budgeted,
    exposure: creditExposure(snapshot),
    obligations: obligations(snapshot),
    suggestions: suggestScheduled(snapshot),
    baseline: spendBaseline,
    anomalies: detectAnomalies(transactions, spendBaseline.categories, spendBaseline.asOf, settings.dismissedAnomalies),
    upcoming: scheduledOutflows(scheduled, today, new Date(Date.parse(`${today}T00:00:00Z`) + 62 * 86400000).toISOString().slice(0, 10)),
    /** Income counted and spending in a full month (yyyy-mm), by the Home rules, for the monthly report. */
    monthFlow: (m: string) => {
      const [y, mo] = m.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
      const flow = monthlyFlowFor(transactions, items, month.categories, lastDay);
      return { month: m, income: flow.income, spent: flow.expenses };
    },
    /** Spending in a month in the categories that are fixed today. */
    fixedSpent: (m: string) => {
      const fixed = new Set(comparisons.filter((c) => c.type === "fixed").map((c) => c.categoryId));
      return items.filter((i) => i.date.startsWith(m) && fixed.has(i.categoryId)).reduce((sum, i) => sum + i.amount, 0);
    },
    uncategorizedCount: transactions.filter(
      (t) => !t.deleted && t.date >= since && !t.transfer_account_id && !t.subtransactions?.length && isUncategorized(t)
    ).length,
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

/** Spending category ids of the current YNAB month, to validate settings. */
export async function spendingCategoryIds(token: string): Promise<Set<string>> {
  const { month } = await ynabRequest<{ month: Month }>(token, `${budgetPath()}/months/current`);
  return new Set(spendingCategories(month).map((c) => c.id));
}

/** Creates a monthly scheduled outflow in YNAB and records its id. Called only from the user's click. */
export async function createScheduled(token: string, s: NewScheduled): Promise<string> {
  const { scheduled_transaction: created } = await ynabRequest<{ scheduled_transaction: { id: string } }>(token, `${budgetPath()}/scheduled_transactions`, {
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
  const settings = loadSettings();
  settings.createdScheduleIds = [...new Set([...settings.createdScheduleIds, created.id])];
  saveSettings(settings);
  return created.id;
}

/** Inbox Undo: deletes a schedule in YNAB, only if this app created it. Called only from the user's click. */
export async function deleteCreatedScheduled(token: string, id: string): Promise<void> {
  if (!loadSettings().createdScheduleIds.includes(id)) {
    throw new Error("Only a schedule that this app created can be deleted.");
  }
  await ynabRequest(token, `${budgetPath()}/scheduled_transactions/${encodeURIComponent(id)}`, { method: "DELETE" });
  const settings = loadSettings();
  settings.createdScheduleIds = settings.createdScheduleIds.filter((x) => x !== id);
  saveSettings(settings);
}

export function restoreAnomaly(id: string): Settings {
  const settings = loadSettings();
  settings.dismissedAnomalies = settings.dismissedAnomalies.filter((x) => x !== id);
  saveSettings(settings);
  return settings;
}

export function restoreSuggestion(id: string): Settings {
  const settings = loadSettings();
  settings.ignoredSuggestions = settings.ignoredSuggestions.filter((x) => x !== id);
  saveSettings(settings);
  return settings;
}

export function dismissAnomaly(id: string): Settings {
  const settings = loadSettings();
  settings.dismissedAnomalies = [...new Set([...settings.dismissedAnomalies, id])];
  saveSettings(settings);
  return settings;
}

export function ignoreSuggestion(id: string): Settings {
  const settings = loadSettings();
  settings.ignoredSuggestions = [...new Set([...settings.ignoredSuggestions, id])];
  saveSettings(settings);
  return settings;
}
