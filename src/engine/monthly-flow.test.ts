import { describe, expect, it } from "vitest";
import type { YnabTransaction } from "../ynab/categorize.js";
import { spendItems } from "./baseline.js";
import { monthlyFlowFor } from "./monthly-flow.js";

const K = 1000;

function txn(overrides: Partial<YnabTransaction>): YnabTransaction {
  return {
    id: "t",
    date: "2026-10-01",
    amount: -100 * K,
    memo: null,
    payee_name: "Shop",
    category_id: "groceries",
    category_name: "Groceries",
    account_id: "checking",
    account_name: "Checking",
    transfer_account_id: null,
    deleted: false,
    ...overrides,
  };
}

describe("monthlyFlowFor", () => {
  it("counts this month's income and the previous month's final seven days, with expenses", () => {
    const transactions = [
      txn({ amount: -100 * K }),
      txn({ amount: 20 * K }),
      txn({ date: "2026-10-02", amount: 1000 * K, category_id: "inflow", category_name: "Inflow: Ready to Assign" }),
      txn({ date: "2026-09-24", amount: 2000 * K, category_id: "inflow", category_name: "Inflow: Ready to Assign" }),
      txn({ date: "2026-09-23", amount: 3000 * K, category_id: "inflow", category_name: "Inflow: Ready to Assign" }),
      txn({ date: "2026-10-03", amount: 500 * K, category_id: null, category_name: null }),
      txn({ date: "2026-10-04", amount: 700 * K, transfer_account_id: "savings", category_id: null, category_name: null }),
      txn({ date: "2026-10-05", amount: 900 * K, deleted: true, category_id: "inflow", category_name: "Inflow: Ready to Assign" }),
    ];

    expect(monthlyFlowFor(transactions, spendItems(transactions), [], "2026-10-15")).toEqual({
      month: "2026-10",
      expenses: 80 * K,
      income: 3500 * K,
      incomeThisMonth: 1500 * K,
      carriedIncome: 2000 * K,
      carryoverFrom: "2026-09-24",
      carryoverTo: "2026-09-30",
    });
  });

  it("uses the final seven calendar days in leap February", () => {
    const transactions = [
      txn({ date: "2024-02-23", amount: 100 * K, category_id: "inflow", category_name: "Inflow: Ready to Assign" }),
      txn({ date: "2024-02-22", amount: 200 * K, category_id: "inflow", category_name: "Inflow: Ready to Assign" }),
    ];

    expect(monthlyFlowFor(transactions, [], [], "2024-03-01")).toMatchObject({
      carriedIncome: 100 * K,
      carryoverFrom: "2024-02-23",
      carryoverTo: "2024-02-29",
    });
  });
});
