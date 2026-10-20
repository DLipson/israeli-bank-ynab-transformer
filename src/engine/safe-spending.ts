/**
 * Safe-spending engine: pure calculations over one snapshot of YNAB data and the user's settings.
 * Spec: docs/financial-intelligence-notes.md, "Safe-spending spec". Amounts are YNAB milliunits.
 * Fixed payments are YNAB scheduled transactions; the engine also suggests new ones from history.
 * The I/O (YNAB, cache, settings file) is in safe-spending-service.ts.
 */
import {
  identityKey,
  parseBankText,
  readMemo,
  readMemoFields,
  type YnabTransaction,
} from "../ynab/categorize.js";
import { expectedRest, predictItems, similarPayee, spendItems } from "./baseline.js";
import { parseChargeDate } from "./charge-date.js";

export interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  on_budget: boolean;
  closed: boolean;
  deleted: boolean;
}

export interface MonthCategory {
  id: string;
  name: string;
  category_group_name: string;
  balance: number;
  budgeted: number;
  /** Spending this month is negative, as in YNAB. */
  activity?: number;
  hidden: boolean;
  deleted: boolean;
}

export interface Month {
  month: string;
  activity?: number;
  to_be_budgeted: number;
  categories: MonthCategory[];
}

export type Frequency =
  | "never"
  | "daily"
  | "weekly"
  | "everyOtherWeek"
  | "twiceAMonth"
  | "every4Weeks"
  | "monthly"
  | "everyOtherMonth"
  | "every3Months"
  | "every4Months"
  | "twiceAYear"
  | "yearly"
  | "everyOtherYear";

export interface ScheduledTransaction {
  id: string;
  date_next: string;
  frequency: Frequency;
  amount: number;
  account_id: string;
  transfer_account_id?: string | null;
  payee_name: string | null;
  category_id?: string | null;
  category_name: string | null;
  deleted: boolean;
}

export interface CreditLimitGroup {
  name: string;
  limit: number;
  accountIds: string[];
}

export interface Settings {
  mode: "cashflow" | "ynab";
  payday: "month-start" | number;
  buffer: number;
  /** Mode B. Empty = every spending category. */
  flexibleCategoryIds: string[];
  essentialCategoryIds: string[];
  essentialsOverride: { period: string; amounts: Record<string, number> } | null;
  cardWarningLevel: number;
  creditLimits: CreditLimitGroup[];
  /** Suggested scheduled transactions the user ignored, as "accountId|identityKey". */
  ignoredSuggestions: string[];
  /** Full past months the baseline uses. */
  baselineMonths: number;
  /** Anomaly findings the user dismissed, by id. */
  dismissedAnomalies: string[];
  /** Schedules this app created in YNAB; Inbox Undo may delete only these. */
  createdScheduleIds: string[];
  /** "Treat as refund" links, kept here because YNAB does not link a refund to its purchase. */
  refundLinks: Array<{ refundTxId: string; purchaseTxId: string }>;
  /** The user's marks on money-in entries: "not-income" (a reconciliation) or "income" (a transfer to count). */
  incomeMarks: Record<string, "income" | "not-income">;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "cashflow",
  payday: "month-start",
  buffer: 0,
  flexibleCategoryIds: [],
  essentialCategoryIds: [],
  essentialsOverride: null,
  cardWarningLevel: 1_000_000,
  creditLimits: [],
  ignoredSuggestions: [],
  baselineMonths: 6,
  dismissedAnomalies: [],
  createdScheduleIds: [],
  refundLinks: [],
  incomeMarks: {},
};

/** Convert a saved inclusive end day to the following payday; month-end and day 31 become month-start. */
export function paydayFromPeriodEnd(periodEnd: "month-end" | number): "month-start" | number {
  if (periodEnd === "month-end" || !Number.isInteger(periodEnd) || periodEnd < 1 || periodEnd >= 31) {
    return "month-start";
  }
  return periodEnd + 1;
}

/** Load current settings while dropping keys removed from the on-disk format. */
export function settingsFromSaved(
  saved: Partial<Settings> & {
    periodEnd?: "month-end" | number;
    overdraft?: unknown;
    subtractExpected?: unknown;
  } = {}
): Settings {
  const current = { ...saved };
  const oldPeriodEnd = current.periodEnd;
  delete current.periodEnd;
  delete current.overdraft;
  delete current.subtractExpected;
  return {
    ...DEFAULT_SETTINGS,
    ...current,
    payday:
      current.payday ??
      (oldPeriodEnd === undefined ? DEFAULT_SETTINGS.payday : paydayFromPeriodEnd(oldPeriodEnd)),
  } as Settings;
}

export interface Snapshot {
  today: string;
  accounts: Account[];
  month: Month;
  transactions: YnabTransaction[];
  scheduled: ScheduledTransaction[];
  settings: Settings;
}

export interface Line {
  label: string;
  amount: number;
}

export interface AvailableItem {
  label: string;
  amount: number;
  date?: string;
  txId?: string;
  categoryId?: string;
  assigned?: number;
  normal?: number;
}

export interface AvailableLine extends Line {
  key: "cash" | "cards" | "bills" | "essentials" | "buffer";
  items: AvailableItem[];
}

export interface LeftToSpend {
  total: number;
  lines: Line[];
  warnings: string[];
}

export interface AvailableUntilPayday extends LeftToSpend {
  periodEnd: string;
  lines: AvailableLine[];
  essentialsNotChosen: boolean;
  essentialsOverridden: boolean;
}

// --- Dates (ISO yyyy-mm-dd, no time zones) ---

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

/** The date in the given month for a day of month, clamped to the month's last day (31 → 30 Nov). */
function dayIn(year: number, month: number, day: number): string {
  return iso(year, month, Math.min(day, daysInMonth(year, month)));
}

function addMonths(year: number, month: number, n: number): [number, number] {
  const index = year * 12 + (month - 1) + n;
  return [Math.floor(index / 12), (index % 12) + 1];
}

function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function periodEndDate(today: string, payday: Settings["payday"]): string {
  const [y, m, d] = parts(today);
  if (payday === "month-start") return dayIn(y, m, 31);
  // Compare the clamped payday: payday 30 is 28 Feb in February.
  const [py, pm] = Math.min(payday, daysInMonth(y, m)) > d ? [y, m] : addMonths(y, m, 1);
  return addDays(dayIn(py, pm, payday), -1);
}

// --- Scheduled transactions ---

const MONTH_STEPS: Partial<Record<Frequency, number>> = {
  monthly: 1,
  everyOtherMonth: 2,
  every3Months: 3,
  every4Months: 4,
  twiceAYear: 6,
  yearly: 12,
  everyOtherYear: 24,
};
const DAY_STEPS: Partial<Record<Frequency, number>> = { daily: 1, weekly: 7, everyOtherWeek: 14, every4Weeks: 28 };

/** The dates a scheduled transaction falls on, from its next date up to `to`. */
export function occurrences(s: Pick<ScheduledTransaction, "date_next" | "frequency">, to: string): string[] {
  const dates: string[] = [];
  const [y, m, d] = parts(s.date_next);
  for (let i = 0; i < 400; i++) {
    let date: string;
    if (s.frequency === "never") date = i === 0 ? s.date_next : "9999-12-31";
    else if (DAY_STEPS[s.frequency]) date = addDays(s.date_next, i * DAY_STEPS[s.frequency]!);
    else if (MONTH_STEPS[s.frequency]) {
      const [year, month] = addMonths(y, m, i * MONTH_STEPS[s.frequency]!);
      date = dayIn(year, month, d);
    } else {
      // twiceAMonth: the given day, and 15 days later in the same month (inferred from YNAB's UI).
      const [year, month] = addMonths(y, m, Math.floor(i / 2));
      date = dayIn(year, month, i % 2 === 0 ? d : d + 15);
    }
    if (date > to) break;
    dates.push(date);
  }
  return dates;
}

/**
 * Scheduled outflows from `from` to `to`, one entry per date. Income is never counted ahead, and a
 * scheduled transfer (a card payment from the bank) only moves money between own accounts.
 */
export function scheduledOutflows(
  scheduled: ScheduledTransaction[],
  from: string,
  to: string
): Array<{ date: string; label: string; amount: number }> {
  return scheduled
    .filter((s) => !s.deleted && s.amount < 0 && !s.transfer_account_id)
    .flatMap((s) =>
      occurrences(s, to)
        .filter((date) => date >= from)
        .map((date) => ({ date, label: s.payee_name ?? s.category_name ?? "Scheduled", amount: -s.amount }))
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

// --- Suggested scheduled transactions, from history ---

export interface ScheduleSuggestion {
  /** "accountId|identityKey": stable id for ignore. */
  id: string;
  label: string;
  accountId: string;
  /** Positive milliunits (the typical amount). */
  amount: number;
  dayOfMonth: number;
  nextDate: string;
  categoryId: string | null;
  /** True when the amount changed between months: YNAB matches imports only on the exact amount. */
  amountVaries: boolean;
  months: number;
}

const DETECT_MONTHS = 4;
const DETECT_MIN_MONTHS = 3;
const AMOUNT_SPREAD = 1.25;
const DAY_SPREAD = 5;
const COVER_DAYS = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function memoFields(memo: string | null): Record<string, unknown> {
  return readMemoFields(memo) ?? {};
}

/** True when a scheduled transaction on the account already covers this amount and day. */
function covered(s: ScheduledTransaction[], accountId: string, amount: number, day: number): boolean {
  return s.some((x) => {
    if (x.deleted || x.amount >= 0 || x.account_id !== accountId || x.frequency !== "monthly") return false;
    const gap = Math.abs(parts(x.date_next)[2] - day);
    return Math.abs(-x.amount - amount) <= amount * (AMOUNT_SPREAD - 1) && Math.min(gap, 31 - gap) <= COVER_DAYS;
  });
}

/**
 * Payments that repeat monthly and have no scheduled transaction yet: same payee and account in
 * at least 3 of the last 4 full months, amounts within 25%, days of month within 5 days.
 * Cash withdrawals, transfers, and installments are left out (installments count from their plan).
 */
export function suggestScheduled(snapshot: Snapshot): ScheduleSuggestion[] {
  const { transactions, today, scheduled, settings } = snapshot;
  const [y, m] = parts(today);
  const months = Array.from({ length: DETECT_MONTHS }, (_, i) => {
    const [year, month] = addMonths(y, m, -(i + 1));
    return iso(year, month, 1).slice(0, 7);
  });
  const groups = new Map<string, YnabTransaction[]>();
  for (const t of transactions) {
    if (t.deleted || t.transfer_account_id || t.amount >= 0 || !months.includes(t.date.slice(0, 7))) continue;
    if (/^נמשך מכרטיס/.test(readMemo(t.memo).bankText) || t.payee_name === "משיכת מזומן") continue;
    if (typeof memoFields(t.memo).installment === "string") continue;
    const key = identityKey(t);
    if (!key) continue;
    const id = `${t.account_id}|${key}`;
    const list = groups.get(id);
    if (list) list.push(t);
    else groups.set(id, [t]);
  }

  const ignored = new Set(settings.ignoredSuggestions);
  const found: ScheduleSuggestion[] = [];
  for (const [id, list] of groups) {
    if (ignored.has(id)) continue;
    // One payment per month: the largest, so a small extra charge does not hide the pattern.
    const byMonth = new Map<string, YnabTransaction>();
    for (const t of list) {
      const month = t.date.slice(0, 7);
      const current = byMonth.get(month);
      if (!current || Math.abs(t.amount) > Math.abs(current.amount)) byMonth.set(month, t);
    }
    if (byMonth.size < DETECT_MIN_MONTHS) continue;
    const picks = [...byMonth.values()].sort((a, b) => b.date.localeCompare(a.date));
    const amounts = picks.map((t) => Math.abs(t.amount));
    const days = picks.map((t) => parts(t.date)[2]);
    if (Math.max(...amounts) > Math.min(...amounts) * AMOUNT_SPREAD) continue;
    if (Math.max(...days) - Math.min(...days) > DAY_SPREAD) continue;

    const amount = median(amounts);
    const dayOfMonth = median(days);
    const accountId = picks[0].account_id;
    if (covered(scheduled, accountId, amount, dayOfMonth)) continue;

    const categoryCounts = new Map<string, number>();
    for (const t of picks) if (t.category_id) categoryCounts.set(t.category_id, (categoryCounts.get(t.category_id) ?? 0) + 1);
    const categoryId = [...categoryCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    // A standing order's payee is the generic "הוראת קבע"; the recipient is in the bank text.
    const { counterparty, merchant } = parseBankText(readMemo(picks[0].memo).bankText);
    const [ty, tm, td] = parts(today);
    const [ny, nm] = dayOfMonth > td ? [ty, tm] : addMonths(ty, tm, 1);

    found.push({
      id,
      label: counterparty || merchant || picks[0].payee_name || identityKey(picks[0]),
      accountId,
      amount,
      dayOfMonth,
      nextDate: dayIn(ny, nm, dayOfMonth),
      categoryId,
      amountVaries: new Set(amounts).size > 1,
      months: byMonth.size,
    });
  }
  return found.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

// --- Installments ---

export interface InstallmentPlan {
  accountId: string;
  payee: string;
  paid: number;
  total: number;
  /** Positive milliunits per payment. */
  payment: number;
  /** Charge date of the latest imported payment. */
  lastCharge: string;
  remaining: number;
}

/**
 * Active installment plans from the memo field `installment: "n/total"` that this repo writes.
 * A plan is identified by account, payee, original amount, and number of payments; its latest
 * imported payment gives what is left. Plans whose last charge is more than 2 months old are
 * treated as ended or no longer imported.
 */
export function installmentPlans(transactions: YnabTransaction[], today: string): InstallmentPlan[] {
  const [y, m] = parts(today);
  const [sy, sm] = addMonths(y, m, -2);
  const cutoff = iso(sy, sm, 1);
  const plans = new Map<string, InstallmentPlan>();
  for (const t of transactions) {
    if (t.deleted) continue;
    const memo = memoFields(t.memo);
    if (typeof memo.installment !== "string") continue;
    const [paid, total] = memo.installment.split("/").map(Number);
    if (!paid || !total) continue;
    const lastCharge = parseChargeDate(t.memo) ?? t.date;
    const key = `${t.account_id}|${t.payee_name}|${memo.originalAmount ?? ""}|${total}`;
    const current = plans.get(key);
    if (current && current.paid >= paid) continue;
    const payment = Math.abs(t.amount);
    plans.set(key, { accountId: t.account_id, payee: t.payee_name ?? "", paid, total, payment, lastCharge, remaining: (total - paid) * payment });
  }
  return [...plans.values()].filter((p) => p.paid < p.total && p.lastCharge >= cutoff);
}

// --- Accounts ---

const MONEY_TYPES = new Set(["checking", "savings", "cash"]);
const OWED_TYPES = new Set(["creditCard", "lineOfCredit"]);

function openOnBudget(accounts: Account[]): Account[] {
  return accounts.filter((a) => a.on_budget && !a.closed && !a.deleted);
}

// --- Mode A: cash-flow ---

export function leftCashflow(snapshot: Snapshot): AvailableUntilPayday {
  const accounts = openOnBudget(snapshot.accounts);
  const end = periodEndDate(snapshot.today, snapshot.settings.payday);
  const cash = accounts
    .filter((a) => MONEY_TYPES.has(a.type))
    .map((a) => ({ label: a.name, amount: a.balance }));
  const cards = accounts
    .filter((a) => OWED_TYPES.has(a.type) && a.balance !== 0)
    .map((a) => ({ label: a.name, amount: a.balance }));
  // One posted transaction clears one schedule date only, so a duplicate schedule stays visible.
  const usedTxIds = new Set<string>();
  const bills = snapshot.scheduled
    .flatMap((s) => {
      if (s.deleted || s.transfer_account_id || s.amount >= 0) return [];
      const label = s.payee_name ?? s.category_name ?? "Scheduled";
      return occurrences(s, end)
        .filter((date) => date >= snapshot.today)
        .map((date) => ({ s, label, date }));
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter(({ s, date }) => {
      const match = snapshot.transactions.find(
        (t) =>
          !t.deleted &&
          !usedTxIds.has(t.id) &&
          !t.transfer_account_id &&
          t.account_id === s.account_id &&
          similarPayee(t.payee_name, s.payee_name) &&
          Math.abs(Math.abs(t.amount) - Math.abs(s.amount)) <= Math.abs(s.amount) * 0.25 &&
          Math.abs(Date.parse(`${t.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) <= 5 * 86400000
      );
      if (match) usedTxIds.add(match.id);
      return !match;
    })
    .map(({ s, label, date }) => ({ label, amount: s.amount, date }));

  const allItems = spendItems(snapshot.transactions);
  const predictedItems = predictItems(allItems, snapshot.scheduled);
  const categories = spendingCategories(snapshot.month);
  const override = snapshot.settings.essentialsOverride;
  let essentialsOverridden = false;
  const essentials = snapshot.settings.essentialCategoryIds.flatMap((categoryId) => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return [];
    const spent = allItems
      .filter(
        (item) =>
          item.categoryId === categoryId &&
          item.date >= snapshot.month.month &&
          item.date <= snapshot.today
      )
      .reduce((sum, item) => sum + item.amount, 0);
    const assigned = category.budgeted;
    const normal =
      assigned > 0
        ? 0
        : expectedRest(
            predictedItems.filter((item) => item.categoryId === categoryId),
            snapshot.today,
            end,
            snapshot.settings.baselineMonths
          );
    const calculated = assigned > 0 ? Math.max(0, assigned - spent) : normal;
    const hasOverride = override?.period === end && Object.hasOwn(override.amounts, categoryId);
    if (hasOverride) essentialsOverridden = true;
    const amount = hasOverride ? override!.amounts[categoryId] : calculated;
    return [
      {
        label: category.name,
        amount: amount ? -amount : 0,
        categoryId,
        ...(assigned > 0 ? { assigned } : {}),
        ...(normal > 0 ? { normal } : {}),
      },
    ];
  });
  const buffer = snapshot.settings.buffer
    ? [{ label: "Buffer", amount: -snapshot.settings.buffer }]
    : [];
  const lines: AvailableLine[] = [
    { key: "cash", label: "Cash", amount: cash.reduce((sum, item) => sum + item.amount, 0), items: cash },
    { key: "cards", label: "Card balance", amount: cards.reduce((sum, item) => sum + item.amount, 0), items: cards },
    { key: "bills", label: "Bills still to come", amount: bills.reduce((sum, item) => sum + item.amount, 0), items: bills },
    { key: "essentials", label: "Everyday essentials", amount: essentials.reduce((sum, item) => sum + item.amount, 0), items: essentials },
    { key: "buffer", label: "Buffer", amount: buffer.reduce((sum, item) => sum + item.amount, 0), items: buffer },
  ];
  const warnings = snapshot.scheduled.some((s) => !s.deleted && s.amount < 0)
    ? []
    : ["No scheduled transactions in YNAB yet, so no fixed payments are subtracted."];
  return {
    periodEnd: end,
    total: lines.reduce((sum, line) => sum + line.amount, 0),
    lines,
    warnings,
    essentialsNotChosen: snapshot.settings.essentialCategoryIds.length === 0,
    essentialsOverridden,
  };
}

// --- Mode B: YNAB categories ---

const NON_SPENDING_GROUPS = new Set(["Credit Card Payments", "Internal Master Category", "Hidden Categories"]);

export function spendingCategories(month: Month): MonthCategory[] {
  return month.categories.filter((c) => !c.hidden && !c.deleted && !NON_SPENDING_GROUPS.has(c.category_group_name));
}

export function leftYnab(snapshot: Snapshot): LeftToSpend {
  const chosen = new Set(snapshot.settings.flexibleCategoryIds);
  const categories = spendingCategories(snapshot.month).filter((c) => chosen.size === 0 || chosen.has(c.id));
  const byGroup = new Map<string, number>();
  for (const c of categories) byGroup.set(c.category_group_name, (byGroup.get(c.category_group_name) ?? 0) + c.balance);
  const lines = [...byGroup].map(([label, amount]) => ({ label, amount })).filter((l) => l.amount !== 0);
  const warnings: string[] = [];
  if (snapshot.month.to_be_budgeted > 0) {
    warnings.push(`${formatShekels(snapshot.month.to_be_budgeted)} is in Ready to Assign and in no category, so this number leaves it out.`);
  }
  return { total: lines.reduce((s, l) => s + l.amount, 0), lines, warnings };
}

// --- Credit exposure ---

export interface ExposureGroup {
  name: string;
  limit: number | null;
  used: number;
  unused: number | null;
  lines: Line[];
}

export function creditExposure(snapshot: Snapshot): ExposureGroup[] {
  const accounts = openOnBudget(snapshot.accounts);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const plans = installmentPlans(snapshot.transactions, snapshot.today);
  const groups: ExposureGroup[] = [];

  const configured = snapshot.settings.creditLimits;
  const grouped = new Set(configured.flatMap((g) => g.accountIds));
  const defaults = accounts
    .filter((a) => OWED_TYPES.has(a.type) && !grouped.has(a.id))
    .map((a) => ({ name: a.name, limit: null as number | null, accountIds: [a.id] }));

  for (const g of [...configured, ...defaults]) {
    const lines: Line[] = [];
    for (const id of g.accountIds) {
      const a = byId.get(id);
      if (!a) continue;
      if (a.balance < 0) lines.push({ label: `${a.name} balance`, amount: -a.balance });
      const future = plans.filter((p) => p.accountId === id).reduce((s, p) => s + p.remaining, 0);
      if (future) lines.push({ label: `${a.name} future installments`, amount: future });
    }
    const used = lines.reduce((s, l) => s + l.amount, 0);
    groups.push({ name: g.name, limit: g.limit, used, unused: g.limit === null ? null : g.limit - used, lines });
  }
  return groups;
}

// --- Obligations for coming months ---

export interface MonthObligations {
  month: string;
  installments: number;
  scheduled: number;
  total: number;
  items: {
    scheduled: Array<{ label: string; date: string; amount: number }>;
    installments: Array<{ payee: string; account: string; payment: number; paymentsLeft: number }>;
  };
}

/**
 * Per month from next month: installment charges not yet in a card balance, plus scheduled outflows.
 * The next installment of each plan is usually already imported (charged next month), so it is in
 * the card balance and not counted here.
 */
export function obligations(snapshot: Snapshot, months = 12): MonthObligations[] {
  const [y, m] = parts(snapshot.today);
  const plans = installmentPlans(snapshot.transactions, snapshot.today);
  const [ly, lm] = addMonths(y, m, months);
  const outflows = scheduledOutflows(snapshot.scheduled, iso(...addMonths(y, m, 1), 1), dayIn(ly, lm, 31));
  const names = new Map(snapshot.accounts.map((a) => [a.id, a.name]));
  return Array.from({ length: months }, (_, i) => {
    const [year, month] = addMonths(y, m, i + 1);
    const label = iso(year, month, 1).slice(0, 7);
    const planItems = plans.flatMap((p) => {
      const [py, pm] = parts(p.lastCharge);
      const ahead = (year - py) * 12 + (month - pm);
      const left = p.total - p.paid;
      return ahead >= 1 && ahead <= left
        ? [{ payee: p.payee, account: names.get(p.accountId) ?? "", payment: p.payment, paymentsLeft: left - ahead + 1 }]
        : [];
    });
    const scheduledItems = outflows.filter((o) => o.date.startsWith(label));
    const installments = planItems.reduce((s, p) => s + p.payment, 0);
    const scheduled = scheduledItems.reduce((s, o) => s + o.amount, 0);
    return { month: label, installments, scheduled, total: installments + scheduled, items: { scheduled: scheduledItems, installments: planItems } };
  });
}

export function formatShekels(milliunits: number): string {
  const value = Math.round(milliunits / 1000);
  return `${value < 0 ? "−" : ""}₪${Math.abs(value).toLocaleString("en-US")}`;
}
