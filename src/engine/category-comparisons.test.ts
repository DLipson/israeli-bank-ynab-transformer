import { describe, expect, it } from "vitest";
import type { YnabTransaction } from "../ynab/categorize.js";
import { spendItems } from "./baseline.js";
import { categoryComparisons, monthAverage, whatPushedOver } from "./category-comparisons.js";
import type { ScheduledTransaction } from "./safe-spending.js";

const K = 1000;
const today = "2026-10-20";
let nextId = 0;

function txn(date: string, categoryId: string, amount: number, overrides: Partial<YnabTransaction> = {}): YnabTransaction {
  return {
    id: `t${nextId++}`,
    date,
    amount: -amount * K,
    memo: null,
    payee_name: `${categoryId} shop`,
    category_id: categoryId,
    category_name: categoryId,
    account_id: "checking",
    account_name: "Checking",
    transfer_account_id: null,
    deleted: false,
    ...overrides,
  };
}

/** The 6 full months before October 2026. */
const PAST = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

function compare(transactions: YnabTransaction[], essentialCategoryIds: string[] = [], scheduled: ScheduledTransaction[] = []) {
  return categoryComparisons({
    items: spendItems(transactions),
    transactions,
    today,
    asOf: today,
    months: 6,
    essentialCategoryIds,
    scheduled,
  });
}

function groceries(thisMonth: number): YnabTransaction[] {
  // 3 payments a month, so the category is not fixed; normal by the 20th is ₪500.
  return [
    ...PAST.flatMap((m) => [txn(`${m}-05`, "groceries", 250), txn(`${m}-10`, "groceries", 250), txn(`${m}-25`, "groceries", 500)]),
    txn("2026-10-08", "groceries", thisMonth),
  ];
}

describe("categoryComparisons", () => {
  it("compares an essential with the normal by this day", () => {
    const result = compare(groceries(900), ["groceries"]);
    expect(result.find((c) => c.categoryId === "groceries")).toMatchObject({
      type: "essential",
      thisMonth: 900 * K,
      compareTo: 500 * K,
      compareLabel: "normal by this day",
      difference: 400 * K,
    });
    expect(whatPushedOver(result).map((c) => c.categoryId)).toEqual(["groceries"]);
    expect(whatPushedOver(compare(groceries(650), ["groceries"]))).toEqual([]); // 30% but only ₪150 over
  });

  it("compares an occasional category with the 12-month average", () => {
    const transactions = [txn("2025-10-05", "other", 10), txn("2026-03-12", "clothing", 1200), txn("2026-10-06", "clothing", 829)];
    const clothing = compare(transactions).find((c) => c.categoryId === "clothing");
    expect(clothing).toMatchObject({
      type: "occasional",
      thisMonth: 829 * K,
      compareTo: 100 * K,
      compareLabel: "12-month average",
      difference: 729 * K,
    });
    expect(clothing?.items).toEqual([expect.objectContaining({ date: "2026-10-06", amount: -829 * K })]);
    expect(whatPushedOver(compare(transactions)).map((c) => c.categoryId)).toEqual(["clothing"]);
  });

  it("averages over the months with data when history is shorter than 12 months", () => {
    const items = spendItems([txn("2026-06-03", "gifts", 400), txn("2026-07-03", "other", 1)]);
    expect(monthAverage(items, "gifts", today, 12)).toBe(100 * K); // June–September: 4 months
  });

  it("compares a fixed category with the normal month", () => {
    const rent = (thisMonth: number) => [...PAST.map((m) => txn(`${m}-01`, "rent", 3000)), txn("2026-10-01", "rent", thisMonth)];
    expect(compare(rent(3500)).find((c) => c.categoryId === "rent")).toMatchObject({
      type: "fixed",
      thisMonth: 3500 * K,
      compareTo: 3000 * K,
      compareLabel: "normal month",
      difference: 500 * K,
    });
    expect(whatPushedOver(compare(rent(3500))).map((c) => c.categoryId)).toEqual(["rent"]);
    expect(whatPushedOver(compare(rent(3250)))).toEqual([]); // under 10% over
  });

  it("types a scheduled essential category as fixed", () => {
    const schedule: ScheduledTransaction = {
      id: "s",
      date_next: "2026-10-25",
      frequency: "monthly",
      amount: -500 * K,
      account_id: "checking",
      payee_name: "groceries shop",
      category_id: "groceries",
      category_name: "groceries",
      deleted: false,
    };
    const result = compare(groceries(900), ["groceries"], [schedule]);
    expect(result.find((c) => c.categoryId === "groceries")).toMatchObject({ type: "fixed", compareLabel: "normal month" });
  });

  it("leaves out uncategorized spending and shows at most 5 reasons, largest first", () => {
    const amounts = [300, 900, 500, 700, 400, 800, 600];
    const transactions = [
      txn("2025-10-05", "other", 1),
      ...amounts.map((amount, i) => txn("2026-10-10", `c${i}`, amount)),
      txn("2026-10-11", "x", 5000, { category_id: null, category_name: null }),
    ];
    const result = compare(transactions);
    expect(result.some((c) => c.categoryId === "Uncategorized")).toBe(false);
    expect(whatPushedOver(result).map((c) => c.thisMonth / K)).toEqual([900, 800, 700, 600, 500]);
  });
});
