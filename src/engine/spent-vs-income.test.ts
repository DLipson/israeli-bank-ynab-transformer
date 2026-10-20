import { describe, expect, it } from "vitest";
import type { YnabTransaction } from "../ynab/categorize.js";
import { spendItems } from "./baseline.js";
import { monthlyFlowFor } from "./monthly-flow.js";
import { spentVsIncomeFor, withRefundLinks } from "./spent-vs-income.js";
import type { Account, MonthCategory } from "./safe-spending.js";

const K = 1000;
const today = "2026-10-20";

function txn(overrides: Partial<YnabTransaction>): YnabTransaction {
  return {
    id: "t",
    date: "2026-10-10",
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

function account(id: string, type: string, name = id): Account {
  return { id, type, name, balance: 0, on_budget: true, closed: false, deleted: false };
}

function overview(
  transactions: YnabTransaction[],
  categories: MonthCategory[] = [],
  accounts: Account[] = [
    account("checking", "checking", "Checking"),
    account("card", "creditCard", "Card"),
    account("savings", "savings", "Savings"),
    account("credit", "lineOfCredit", "Credit line"),
  ],
  date = today
) {
  const items = spendItems(transactions);
  const flow = monthlyFlowFor(transactions, items, categories, date);
  return spentVsIncomeFor(transactions, items, categories, accounts, flow, date);
}

describe("spentVsIncomeFor", () => {
  it("returns every current-month spending transaction and counts savings transfers from any account", () => {
    const transactions = [
      txn({ id: "purchase", account_id: "card", account_name: "Card", amount: -100 * K }),
      txn({ id: "refund", amount: 20 * K }),
      txn({ id: "uncategorized", amount: -30 * K, category_id: null, category_name: null }),
      txn({
        id: "installment",
        amount: -40 * K,
        memo: JSON.stringify({ installment: "3/12" }),
      }),
      txn({
        id: "split-purchase",
        amount: -22 * K,
        subtransactions: [
          { id: "part-1", amount: -10 * K, category_id: "groceries", category_name: "Groceries", transfer_account_id: null, deleted: false },
          { id: "part-2", amount: -7 * K, category_id: null, category_name: null, transfer_account_id: null, deleted: false },
          { id: "part-3", amount: -5 * K, category_id: null, category_name: null, transfer_account_id: "checking", deleted: false },
        ],
      }),
      txn({
        id: "checking-save",
        amount: -15 * K,
        transfer_account_id: "savings",
        category_id: null,
        category_name: null,
      }),
      txn({
        id: "credit-save",
        account_id: "credit",
        account_name: "Credit line",
        amount: -25 * K,
        transfer_account_id: "savings",
        category_id: null,
        category_name: null,
      }),
      txn({
        id: "savings-side",
        account_id: "savings",
        account_name: "Savings",
        amount: 15 * K,
        transfer_account_id: "checking",
        category_id: null,
        category_name: null,
      }),
      txn({
        id: "other-transfer",
        amount: -50 * K,
        transfer_account_id: "checking",
        category_id: null,
        category_name: null,
      }),
    ];

    const result = overview(transactions);
    expect(result.spent).toBe(100 * K - 20 * K + 30 * K + 40 * K + 17 * K);
    expect(result.spendingItems.map((item) => item.id)).toEqual([
      "purchase",
      "refund",
      "uncategorized",
      "installment",
      "split-purchase",
    ]);
    expect(result.spendingItems.find((item) => item.id === "purchase")).toMatchObject({
      date: "2026-10-10",
      account: "Card",
      category: "Groceries",
      amount: -100 * K,
    });
    expect(result.spendingItems.find((item) => item.id === "split-purchase")).toMatchObject({
      amount: -17 * K,
      category: null,
    });
    expect(result.uncategorized).toEqual({ amount: 37 * K, count: 2 });
    expect(result.savedThisMonth.amount).toBe(40 * K);
    expect(result.savedThisMonth.items.map((item) => [item.id, item.amount])).toEqual([
      ["checking-save", -15 * K],
      ["credit-save", -25 * K],
    ]);
  });

  it("groups income by effective payer and labels one-time gifts and large bonuses from history", () => {
    const employerMemo = JSON.stringify({
      bankMemo: "העברה מאת: Acme Payroll 12-345-678",
    });
    const history = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map(
      (month, i) =>
        txn({
          id: `salary-${i}`,
          date: `${month}-15`,
          amount: 4_000 * K,
          memo: employerMemo,
          payee_name: "משכורת",
          category_id: "inflow",
          category_name: "Inflow: Ready to Assign",
        })
    );
    const transactions = [
      ...history,
      txn({
        id: "salary-current",
        date: "2026-10-05",
        amount: 4_000 * K,
        memo: employerMemo,
        payee_name: "משכורת",
        category_id: "inflow",
        category_name: "Inflow: Ready to Assign",
      }),
      txn({
        id: "bonus",
        date: "2026-10-10",
        amount: 7_000 * K,
        memo: employerMemo,
        payee_name: "משכורת",
        category_id: "inflow",
        category_name: "Inflow: Ready to Assign",
      }),
      txn({
        id: "gift",
        date: "2026-10-12",
        amount: 1_200 * K,
        payee_name: "Aunt",
        category_id: "inflow",
        category_name: "Inflow: Ready to Assign",
      }),
      txn({
        id: "merchant-memo-income",
        date: "2026-10-13",
        amount: 800 * K,
        memo: JSON.stringify({ bankMemo: "בכרטיס המסתיים ב-1234 ב-Supermarket" }),
        payee_name: "Other income",
        category_id: "inflow",
        category_name: "Inflow: Ready to Assign",
      }),
      txn({
        id: "uncategorized-income",
        date: "2026-10-14",
        amount: 600 * K,
        payee_name: "Uncategorized inflow",
        category_id: null,
        category_name: null,
      }),
    ];

    const result = overview(transactions);
    const employer = result.incomeParts.find((part) => part.label === "Acme Payroll");
    const gift = result.incomeParts.find((part) => part.label === "Aunt");
    expect(result).toMatchObject({
      month: "2026-10",
      spent: 0,
      income: 13_600 * K,
      difference: 13_600 * K,
      daysLeft: 11,
    });
    expect(result.incomeParts.find((part) => part.label === "Other income")).toMatchObject({
      items: [{ id: "merchant-memo-income", oneTime: true }],
    });
    expect(result.incomeParts.find((part) => part.label === "Uncategorized inflow")).toMatchObject({
      items: [{ id: "uncategorized-income", oneTime: true }],
    });
    expect(employer).toMatchObject({
      amount: 11_000 * K,
      items: [
        { id: "salary-current", date: "2026-10-05", oneTime: false },
        { id: "bonus", date: "2026-10-10", oneTime: true },
      ],
    });
    expect(gift).toMatchObject({
      amount: 1_200 * K,
      items: [{ id: "gift", date: "2026-10-12", oneTime: true }],
    });
  });
});

describe("Treat as refund", () => {
  const purchase = txn({ id: "shoes", date: "2026-09-20", amount: -300 * K, category_id: "clothing", category_name: "Clothing", payee_name: "Shoe shop" });
  const back = (category: Pick<YnabTransaction, "category_id" | "category_name">) =>
    txn({ id: "back", date: "2026-10-08", amount: 300 * K, payee_name: "Shoe shop", ...category });

  it("counts an uncategorized positive entry as income, and the same entry as a refund once it has the purchase's category", () => {
    const before = overview([txn({ id: "food", amount: -1000 * K }), purchase, back({ category_id: null, category_name: null })]);
    expect(before).toMatchObject({ spent: 1000 * K, income: 300 * K });
    const after = overview([txn({ id: "food", amount: -1000 * K }), purchase, back({ category_id: "clothing", category_name: "Clothing" })]);
    expect(after).toMatchObject({ spent: 700 * K, income: 0 });
  });

  it("marks the refund with the purchase it belongs to", () => {
    const transactions = [purchase, back({ category_id: "clothing", category_name: "Clothing" })];
    const result = withRefundLinks(overview(transactions), [{ refundTxId: "back", purchaseTxId: "shoes" }], transactions);
    expect(result.spendingItems.find((t) => t.id === "back")).toMatchObject({ refundOf: { payee: "Shoe shop", date: "2026-09-20" } });
  });
});
