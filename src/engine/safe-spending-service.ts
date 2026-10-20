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
  type ToCheckItem,
  type Snapshot,
} from "./safe-spending.js";
import { baseline, pastMonths, spendItems } from "./baseline.js";
import { monthlyFlowFor } from "./monthly-flow.js";
import { applyIncomeMarks, spentVsIncomeFor, withRefundLinks, type IncomeMark } from "./spent-vs-income.js";
import { categoryComparisons, whatPushedOver } from "./category-comparisons.js";
import { cardGroups, watchItems } from "./cards.js";
import { detectAnomalies } from "./anomalies.js";
import { isUncategorized, type YnabTransaction } from "../ynab/categorize.js";
import { setCategory } from "../ynab/categorize-service.js";

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
  // The user's income marks change only the income and spending lists, not balances or cards.
  const flowTransactions = applyIncomeMarks(transactions, settings.incomeMarks);
  const items = spendItems(flowTransactions);
  const asOf = dataAsOf(transactions, today);
  const spendBaseline = baseline(items, asOf, settings.baselineMonths);
  const comparisons = categoryComparisons({
    items,
    transactions: flowTransactions,
    today,
    asOf,
    months: settings.baselineMonths,
    essentialCategoryIds: settings.essentialCategoryIds,
    scheduled,
  });
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 31 * 86400000).toISOString().slice(0, 10);

  const monthlyFlow = monthlyFlowFor(flowTransactions, items, month.categories, today, month.activity ?? null);
  const spentVsIncome = withRefundLinks(
    { ...spentVsIncomeFor(flowTransactions, items, month.categories, accounts, monthlyFlow, today), reasons: whatPushedOver(comparisons) },
    settings.refundLinks,
    flowTransactions
  );
  return {
    today,
    lastScrapedAt,
    periodEnd: end,
    monthlyFlow,
    spentVsIncome,
    available: cashflow,
    cards,
    watch: watchItems(cards, comparisons, settings.toCheck),
    settings,
    cashflow,
    ynab,
    gap: cashflow.total - ynab.total,
    readyToAssign: month.to_be_budgeted,
    exposure: creditExposure(snapshot),
    obligations: obligations(snapshot),
    suggestions: suggestScheduled(snapshot),
    baseline: spendBaseline,
    // Items on the To check list leave the Inbox; they show in Things to watch.
    anomalies: detectAnomalies(transactions, spendBaseline.categories, spendBaseline.asOf, [...settings.dismissedAnomalies, ...settings.toCheck.map((c) => c.id)]),
    upcoming: scheduledOutflows(scheduled, today, new Date(Date.parse(`${today}T00:00:00Z`) + 62 * 86400000).toISOString().slice(0, 10)),
    /** Income counted and spending in a full month (yyyy-mm), by the Home rules, for the monthly report. */
    monthFlow: (m: string) => {
      const [y, mo] = m.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
      const flow = monthlyFlowFor(flowTransactions, items, month.categories, lastDay);
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
  settings.toCheck = settings.toCheck.filter((c) => c.id !== id);
  saveSettings(settings);
  return settings;
}

export function ignoreSuggestion(id: string): Settings {
  const settings = loadSettings();
  settings.ignoredSuggestions = [...new Set([...settings.ignoredSuggestions, id])];
  saveSettings(settings);
  return settings;
}

// --- Treat as refund ---

const PURCHASE_DAYS = 90;

/** A purchase that a refund can take its category from: one category (no split), not a transfer. */
function pickablePurchase(t: YnabTransaction): boolean {
  return !t.deleted && t.amount < 0 && !t.transfer_account_id && !t.subtransactions?.length && !isUncategorized(t) && t.category_name !== "Inflow: Ready to Assign";
}

/** Purchases of the last 90 days, newest first, for the "Treat as refund" list. Read-only. */
export async function recentPurchases(token: string, today = new Date().toISOString().slice(0, 10)) {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - PURCHASE_DAYS * 86400000).toISOString().slice(0, 10);
  const transactions = await getAllTransactions(token, loadYnabImportConfig().budgetId);
  return transactions
    .filter((t) => pickablePurchase(t) && t.date >= from && t.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => ({ id: t.id, date: t.date, payee: t.payee_name ?? "", account: t.account_name, category: t.category_name, categoryId: t.category_id!, amount: t.amount }));
}

/**
 * Treat as refund: gives an uncategorized positive transaction the category of the purchase it
 * refunds (YNAB write, only from the user's click), then saves the link locally.
 */
export async function treatAsRefund(token: string, refundTxId: string, purchaseTxId: string): Promise<void> {
  const transactions = await getAllTransactions(token, loadYnabImportConfig().budgetId);
  const refund = transactions.find((t) => t.id === refundTxId);
  const purchase = transactions.find((t) => t.id === purchaseTxId);
  const counted = refund && (isUncategorized(refund) || refund.category_name === "Inflow: Ready to Assign");
  if (!refund || refund.deleted || refund.amount <= 0 || refund.transfer_account_id || refund.subtransactions?.length || !counted) {
    throw new Error("Only a money-in transaction that counts as income (uncategorized or Ready to Assign) can be treated as a refund.");
  }
  if (!purchase || !pickablePurchase(purchase)) throw new Error("Pick a purchase with one category.");
  await setCategory(token, refund.id, purchase.category_id!);
  const settings = loadSettings();
  settings.refundLinks = [...settings.refundLinks.filter((l) => l.refundTxId !== refund.id), { refundTxId: refund.id, purchaseTxId: purchase.id }];
  delete settings.incomeMarks[refund.id];
  saveSettings(settings);
}

// --- Income marks ---

const INFLOW_DAYS = 120;

/** Sets or clears (mark null) the user's mark on one money-in transaction. Local only. */
export function setIncomeMark(id: string, mark: IncomeMark | null): Settings {
  const settings = loadSettings();
  if (mark) settings.incomeMarks[id] = mark;
  else delete settings.incomeMarks[id];
  saveSettings(settings);
  return settings;
}

/**
 * Money-in transactions of the last 120 days, newest first, transfers included, with their mark.
 * A transfer into a card or loan account is a payment of that debt, so it is left out. Read-only.
 */
export async function recentInflows(token: string, today = new Date().toISOString().slice(0, 10)) {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - INFLOW_DAYS * 86400000).toISOString().slice(0, 10);
  const marks = loadSettings().incomeMarks;
  const [{ accounts }, transactions] = await Promise.all([
    ynabRequest<{ accounts: Account[] }>(token, `${budgetPath()}/accounts`),
    getAllTransactions(token, loadYnabImportConfig().budgetId),
  ]);
  const debt = new Set(accounts.filter((a) => a.type === "creditCard" || a.type === "lineOfCredit" || /Loan|Debt|Mortgage|Liability/i.test(a.type)).map((a) => a.id));
  return transactions
    .filter((t) => !t.deleted && t.amount > 0 && t.date >= from && t.date <= today && !(t.transfer_account_id && debt.has(t.account_id)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => ({
      id: t.id,
      date: t.date,
      payee: t.payee_name ?? "",
      account: t.account_name,
      category: t.category_name,
      transfer: Boolean(t.transfer_account_id),
      amount: t.amount,
      mark: marks[t.id] ?? null,
    }));
}

/** "Check it": keeps an unusual item on the To check list. Local only. */
export function addToCheck(item: ToCheckItem): Settings {
  const settings = loadSettings();
  settings.toCheck = [...settings.toCheck.filter((c) => c.id !== item.id), item];
  saveSettings(settings);
  return settings;
}

/** Undo of "Check it". */
export function removeToCheck(id: string): Settings {
  const settings = loadSettings();
  settings.toCheck = settings.toCheck.filter((c) => c.id !== id);
  saveSettings(settings);
  return settings;
}
