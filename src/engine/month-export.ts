import { pastMonths } from "./baseline.js";
import type { SpentVsIncome, TxRef } from "./spent-vs-income.js";

const MAX_MONTHS = 24;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function lastFullMonth(today: string): string {
  return pastMonths(today, 1)[0];
}

/** Every month from `from` to `to`, both included (yyyy-mm). Call validateRange first. */
export function monthsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  while (`${y}-${String(m).padStart(2, "0")}` <= to) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

export function validateRange(from: string, to: string, today: string): void {
  for (const [name, value] of [["from", from], ["to", to]]) {
    if (!MONTH_RE.test(value)) throw new Error(`"${name}" must be a month as yyyy-mm, for example 2026-03.`);
  }
  if (from > to) throw new Error('"from" must not be later than "to".');
  if (to > today.slice(0, 7)) throw new Error("Future months have no data.");
  if (monthsInRange(from, to).length > MAX_MONTHS) throw new Error(`A range can have at most ${MAX_MONTHS} months.`);
}

/** What the engine knows about one month, in YNAB milliunits. */
export interface MonthExportInput {
  month: string;
  detail: SpentVsIncome & { through: string; memos: Record<string, string> };
  fixedSpent: number;
  categories: Array<{ id: string; name: string; group: string; type: string; assigned: number; spent: number; normal: number }>;
}

export interface MonthExportSource {
  madeAt: string;
  today: string;
  dataAsOf: string;
  lastScrapedAt: string | null;
  settings: { payday: "month-start" | number; baselineMonths: number; flexibleCategoryIds: string[]; essentialCategoryIds: string[] };
  months: MonthExportInput[];
}

const shekels = (milliunits: number): number => milliunits / 1000;

export function buildMonthExport(input: MonthExportSource) {
  const currentMonth = input.today.slice(0, 7);
  const tx = (memos: Record<string, string>) => (t: TxRef) => ({
    id: t.id,
    date: t.date,
    payee: t.payee,
    account: t.account,
    category: t.category,
    amount: shekels(t.amount),
    memo: memos[t.id] ?? "",
  });
  return {
    madeAt: input.madeAt,
    dataAsOf: input.dataAsOf,
    lastScrapedAt: input.lastScrapedAt,
    settings: input.settings,
    notes: [
      "All amounts are in shekels.",
      "Totals, category spent, fixedSpent, uncategorized and savedTransfers.amount are positive numbers for money spent or saved.",
      "Each transaction amount uses the YNAB sign: negative = money out, positive = money in. A refund is a positive amount in a spending category, and it lowers spent.",
      "Card purchases count on the purchase date.",
      "Transfers between accounts are not counted as income or spending.",
      "Income from the last 7 days of a month counts toward the next month. A month's income is final only after the month ends.",
      'A month with "partial": true is still in progress. Its data ends on "throughDate".',
      "Anomalies and card or installment status are not included for past months.",
      `"normal" is the median month over the last ${input.settings.baselineMonths} months.`,
    ],
    months: input.months.map(({ month, detail, fixedSpent, categories }) => {
      const withMemo = tx(detail.memos);
      return {
        month,
        partial: month === currentMonth,
        throughDate: detail.through,
        totals: { income: shekels(detail.income), spent: shekels(detail.spent), difference: shekels(detail.difference) },
        incomeParts: detail.incomeParts.map((part) => ({
          label: part.label,
          amount: shekels(part.amount),
          items: part.items.map((item) => ({ ...withMemo(item), oneTime: item.oneTime })),
        })),
        transactions: detail.spendingItems
          .map(withMemo)
          .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
        savedTransfers: { amount: shekels(detail.savedThisMonth.amount), items: detail.savedThisMonth.items.map(withMemo) },
        uncategorized: { amount: shekels(detail.uncategorized.amount), count: detail.uncategorized.count },
        categories: categories
          .filter((c) => c.spent !== 0 || c.assigned !== 0)
          .sort((a, b) => b.spent - a.spent)
          .map((c) => ({ ...c, assigned: shekels(c.assigned), spent: shekels(c.spent), normal: shekels(c.normal) })),
        fixedSpent: shekels(fixedSpent),
      };
    }),
  };
}

export type MonthExport = ReturnType<typeof buildMonthExport>;
