/**
 * Spending baseline and pace: what a normal month costs, and whether this month runs faster or
 * slower than normal up to today. Pure; amounts are positive milliunits of spending.
 * Spec: docs/financial-intelligence-notes.md, "Plan: reports + spending baseline".
 *
 * Two inputs from the same history:
 * - "describe" uses all real spending (rent, loans, installments, cash, uncategorized included);
 * - "predict" leaves out what left-to-spend already counts (scheduled payments, installments),
 *   so the expected rest of the month never subtracts those twice.
 */
import type { YnabTransaction } from "../ynab/categorize.js";
import { readMemoFields } from "../ynab/categorize.js";

export interface SpendItem {
  date: string;
  transactionId?: string;
  /** Positive = money spent; a refund is negative. */
  amount: number;
  categoryId: string;
  categoryName: string;
  accountId: string;
  payeeName?: string | null;
  installment: boolean;
}

interface SubTransaction {
  amount: number;
  category_id: string | null;
  category_name: string | null;
  transfer_account_id: string | null;
  deleted: boolean;
}

interface ScheduleLike {
  date_next: string;
  amount: number;
  account_id: string;
  category_id?: string | null;
  category_name?: string | null;
  payee_name?: string | null;
  deleted: boolean;
}

const READY_TO_ASSIGN = "Inflow: Ready to Assign";
const UNCATEGORIZED = "Uncategorized";

/**
 * Real spending, one item per category: split transactions give one item per part. Left out:
 * transfers between budget accounts (no category: the money only moves), income and anything
 * categorized as Ready to Assign. Uncategorized spending is kept under "Uncategorized".
 */
export function spendItems(transactions: YnabTransaction[]): SpendItem[] {
  const items: SpendItem[] = [];
  for (const t of transactions) {
    if (t.deleted) continue;
    const installment = typeof readMemoFields(t.memo)?.installment === "string";
    const parts = (t.subtransactions as SubTransaction[] | undefined)?.filter((s) => !s.deleted);
    const lines = parts?.length
      ? parts
      : [{ amount: t.amount, category_id: t.category_id, category_name: t.category_name, transfer_account_id: t.transfer_account_id, deleted: false }];
    for (const p of lines) {
      if (p.transfer_account_id) continue;
      if (p.category_name === READY_TO_ASSIGN) continue;
      const uncategorized = !p.category_id || p.category_name === UNCATEGORIZED;
      items.push({
        date: t.date,
        transactionId: t.id,
        amount: -p.amount,
        categoryId: uncategorized ? UNCATEGORIZED : p.category_id!,
        categoryName: uncategorized ? UNCATEGORIZED : p.category_name ?? "",
        accountId: t.account_id,
        payeeName: t.payee_name,
        installment,
      });
    }
  }
  return items;
}

// --- Dates ---

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function addMonths(year: number, month: number, n: number): [number, number] {
  const index = year * 12 + (month - 1) + n;
  return [Math.floor(index / 12), (index % 12) + 1];
}

/** The last `count` full months before today's month, newest first. */
export function pastMonths(today: string, count: number): string[] {
  const [y, m] = parts(today);
  return Array.from({ length: count }, (_, i) => monthKey(...addMonths(y, m, -(i + 1))));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Sum of items in `month` whose day is in (fromDay, toDay]. Days past the month's end are clamped. */
function sumDays(items: SpendItem[], month: string, fromDay: number, toDay: number): number {
  let total = 0;
  for (const i of items) {
    if (!i.date.startsWith(month)) continue;
    const day = Number(i.date.slice(8, 10));
    if (day > fromDay && day <= toDay) total += i.amount;
  }
  return total;
}

// --- Predict: leave out what left-to-spend already counts ---

const COVER_SHARE = 0.25;
const COVER_DAYS = 5;

export function normalizedName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function similarPayee(a: string | null | undefined, b: string | null | undefined): boolean {
  const leftName = normalizedName(a);
  const rightName = normalizedName(b);
  if (leftName && leftName === rightName) return true;
  const tokens = (value: string | null | undefined) =>
    new Set(normalizedName(value).split(/\s+/).filter(Boolean));
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return false;
  const overlap = [...left].filter((token) => right.has(token)).length;
  return overlap >= 2 && overlap / Math.min(left.size, right.size) >= 0.75;
}

/** Match by payee, or by category when either payee is missing, then check account, amount, and day. */
function scheduled(item: SpendItem, schedules: ScheduleLike[]): boolean {
  const day = Number(item.date.slice(8, 10));
  return schedules.some((s) => {
    if (s.deleted || s.amount >= 0 || s.account_id !== item.accountId) return false;
    const sameCategory =
      (!!s.category_id && s.category_id === item.categoryId) ||
      (!!normalizedName(s.category_name) && normalizedName(s.category_name) === normalizedName(item.categoryName));
    const itemPayee = normalizedName(item.payeeName);
    const scheduledPayee = normalizedName(s.payee_name);
    const bothHavePayees = Boolean(itemPayee && scheduledPayee);
    if (!similarPayee(itemPayee, scheduledPayee) && (bothHavePayees || !sameCategory)) return false;
    const amount = -s.amount;
    const gap = Math.abs(Number(s.date_next.slice(8, 10)) - day);
    return Math.abs(item.amount - amount) <= amount * COVER_SHARE && Math.min(gap, 31 - gap) <= COVER_DAYS;
  });
}

export function predictItems(items: SpendItem[], schedules: ScheduleLike[]): SpendItem[] {
  return items.filter((i) => !i.installment && !scheduled(i, schedules));
}

/**
 * Normal spending from tomorrow to the period end: for each past month, the spending in the same
 * days of the month (and into the next month when the period crosses it); then the median.
 */
export function expectedRest(items: SpendItem[], today: string, periodEnd: string, months: number): number {
  const [, , d] = parts(today);
  const [ey, em, ed] = parts(periodEnd);
  const [ty, tm] = parts(today);
  const crosses = ey * 12 + em > ty * 12 + tm;
  const values = pastMonths(today, months).map((month) => {
    const [y, m] = parts(`${month}-01`);
    if (!crosses) return sumDays(items, month, d, ed);
    const next = monthKey(...addMonths(y, m, 1));
    return sumDays(items, month, d, daysInMonth(y, m)) + sumDays(items, next, 0, ed);
  });
  return Math.max(0, median(values));
}

// --- Describe: normal month and pace ---

export type PaceStatus = "under" | "on" | "over" | "fixed-paid" | "fixed-due";

export interface Pace {
  name: string;
  /** Median month total. */
  normalMonth: number;
  /** Median spending up to today's day of month. */
  normalByToday: number;
  thisMonth: number;
  /** thisMonth / normalByToday - 1; null when nothing is normal by today. */
  difference: number | null;
  status: PaceStatus;
}

const ON_PACE = 0.15;
/** "Over" also needs this many milliunits over normal (₪200), so small bases do not give huge percentages. */
const MIN_OVER = 200 * 1000;

function paceStatus(thisMonth: number, normalByToday: number): { difference: number | null; status: PaceStatus } {
  if (normalByToday <= 0) return { difference: null, status: thisMonth > MIN_OVER ? "over" : "on" };
  const difference = thisMonth / normalByToday - 1;
  if (difference > ON_PACE && thisMonth - normalByToday >= MIN_OVER) return { difference, status: "over" };
  return { difference, status: difference < -ON_PACE ? "under" : "on" };
}

/**
 * A category that is one payment a month (rent, a loan): pace makes no sense, so it is "paid" or
 * "due". Fixed = in most past months the total is within 10% of the median, from at most 2 payments.
 */
export function isFixed(items: SpendItem[], months: string[]): boolean {
  const normal = median(months.map((m) => sumDays(items, m, 0, 31)));
  if (normal <= 0) return false;
  const steady = months.filter((m) => {
    const list = items.filter((i) => i.date.startsWith(m) && i.amount > 0);
    const total = list.reduce((s, i) => s + i.amount, 0);
    return list.length >= 1 && list.length <= 2 && Math.abs(total - normal) <= normal * 0.1;
  });
  return steady.length >= Math.ceil(months.length * 0.6);
}

/**
 * Pace up to `asOf`: the date of the newest imported transaction, not today. When the bank data
 * is a week old, comparing with today's day of month would show everything as far under pace.
 */
export function pace(items: SpendItem[], asOf: string, months: number, name: string): Pace {
  const day = parts(asOf)[2];
  const past = pastMonths(asOf, months);
  const normalMonth = median(past.map((m) => sumDays(items, m, 0, 31)));
  const normalByToday = median(past.map((m) => sumDays(items, m, 0, day)));
  const thisMonth = sumDays(items, asOf.slice(0, 7), 0, day);
  if (isFixed(items, past)) {
    return { name, normalMonth, normalByToday, thisMonth, difference: null, status: thisMonth >= normalMonth * 0.5 ? "fixed-paid" : "fixed-due" };
  }
  return { name, normalMonth, normalByToday, thisMonth, ...paceStatus(thisMonth, normalByToday) };
}

export interface Baseline {
  months: number;
  /** Pace is measured up to this date (newest imported transaction). */
  asOf: string;
  total: Pace;
  categories: Pace[];
  /** Spending not categorized yet this month; shown apart, not as a category pace. */
  uncategorized: number;
  /** The 3 categories most over pace (by shekels over normal), for reports. */
  topOver: Pace[];
}

export function baseline(items: SpendItem[], asOf: string, months: number): Baseline {
  const total = pace(items, asOf, months, "Total");
  const byCategory = new Map<string, SpendItem[]>();
  for (const i of items) {
    if (i.categoryId === UNCATEGORIZED) continue;
    const list = byCategory.get(i.categoryId);
    if (list) list.push(i);
    else byCategory.set(i.categoryId, [i]);
  }
  const categories = [...byCategory.values()]
    .map((list) => pace(list, asOf, months, list[0].categoryName))
    .filter((p) => p.normalMonth > 0 || p.thisMonth > 0)
    .sort((a, b) => b.normalMonth - a.normalMonth);
  const topOver = categories
    .filter((p) => p.status === "over")
    .sort((a, b) => b.thisMonth - b.normalByToday - (a.thisMonth - a.normalByToday))
    .slice(0, 3);
  const uncategorized = sumDays(
    items.filter((i) => i.categoryId === UNCATEGORIZED),
    asOf.slice(0, 7),
    0,
    parts(asOf)[2]
  );
  return { months, asOf, total, categories, uncategorized, topOver };
}
