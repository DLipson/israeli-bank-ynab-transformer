/**
 * "What pushed you over": each spending category compared in the way that fits its type.
 * Spec thresholds: essential = over pace; occasional = >25% and ≥₪200 above the 12-month average;
 * fixed = >10% and ≥₪200 above the normal month. At most 5, largest shekel difference first.
 */
import type { YnabTransaction } from "../ynab/categorize.js";
import { isFixed, pace, pastMonths, type SpendItem } from "./baseline.js";
import type { ScheduledTransaction } from "./safe-spending.js";
import { spendingRefs, type TxRef } from "./spent-vs-income.js";

export type CategoryType = "essential" | "occasional" | "fixed";

export interface CategoryComparison {
  categoryId: string;
  name: string;
  type: CategoryType;
  thisMonth: number;
  compareTo: number;
  compareLabel: "normal by this day" | "12-month average" | "normal month";
  difference: number;
  items: TxRef[];
}

const MIN_DIFFERENCE = 200 * 1000;
const SHARE: Record<CategoryType, number> = { essential: 0.15, occasional: 0.25, fixed: 0.1 };
const MAX_REASONS = 5;

/**
 * Average spending per month over the last `months` full months. Months before the oldest item
 * in `items` are not counted, so a short history does not lower the average with empty months.
 */
export function monthAverage(items: SpendItem[], categoryId: string, today: string, months = 12): number {
  const oldest = items.reduce((min, i) => (i.date < min ? i.date : min), today).slice(0, 7);
  const counted = new Set(pastMonths(today, months).filter((m) => m >= oldest));
  if (!counted.size) return 0;
  const total = items
    .filter((i) => i.categoryId === categoryId && counted.has(i.date.slice(0, 7)))
    .reduce((sum, i) => sum + i.amount, 0);
  return Math.round(total / counted.size);
}

export function categoryComparisons(input: {
  items: SpendItem[];
  transactions: YnabTransaction[];
  today: string;
  /** Newest imported transaction: essentials pace up to this date (trap 8). */
  asOf: string;
  months: number;
  essentialCategoryIds: string[];
  scheduled: ScheduledTransaction[];
}): CategoryComparison[] {
  const { items, transactions, today, asOf, months } = input;
  const essential = new Set(input.essentialCategoryIds);
  const scheduledCategories = new Set(
    input.scheduled.filter((s) => !s.deleted && s.amount < 0 && s.frequency === "monthly" && s.category_id).map((s) => s.category_id)
  );
  const month = today.slice(0, 7);
  const byCategory = new Map<string, SpendItem[]>();
  for (const i of items) {
    if (i.categoryId === "Uncategorized") continue;
    const list = byCategory.get(i.categoryId);
    if (list) list.push(i);
    else byCategory.set(i.categoryId, [i]);
  }

  const result: CategoryComparison[] = [];
  for (const [categoryId, list] of byCategory) {
    const type: CategoryType =
      scheduledCategories.has(categoryId) || isFixed(list, pastMonths(asOf, months))
        ? "fixed"
        : essential.has(categoryId)
          ? "essential"
          : "occasional";
    const cutoff = type === "essential" ? asOf : today;
    const current = list.filter((i) => i.date.startsWith(month) && i.date <= cutoff);
    const thisMonth = current.reduce((sum, i) => sum + i.amount, 0);
    const p = type === "occasional" ? null : pace(list, asOf, months, list[0].categoryName);
    const [compareTo, compareLabel] =
      type === "essential"
        ? [p!.normalByToday, "normal by this day" as const]
        : type === "fixed"
          ? [p!.normalMonth, "normal month" as const]
          : [monthAverage(items, categoryId, today, 12), "12-month average" as const];
    if (thisMonth === 0 && compareTo === 0) continue;
    result.push({
      categoryId,
      name: list[0].categoryName,
      type,
      thisMonth,
      compareTo,
      compareLabel,
      difference: thisMonth - compareTo,
      items: spendingRefs(current, transactions),
    });
  }
  return result;
}

/** A difference worth showing, by the spec thresholds for the category's type. */
export function isMeaningful(c: CategoryComparison): boolean {
  if (c.compareTo <= 0) return c.thisMonth > MIN_DIFFERENCE;
  return c.thisMonth > c.compareTo * (1 + SHARE[c.type]) && c.difference >= MIN_DIFFERENCE;
}

export function whatPushedOver(comparisons: CategoryComparison[]): CategoryComparison[] {
  return comparisons
    .filter(isMeaningful)
    .sort((a, b) => b.difference - a.difference)
    .slice(0, MAX_REASONS);
}
