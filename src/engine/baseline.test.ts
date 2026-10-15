import { describe, expect, it } from "vitest";
import type { YnabTransaction } from "../ynab/categorize.js";
import { baseline, expectedRest, pace, pastMonths, predictItems, spendItems, type SpendItem } from "./baseline.js";

const K = 1000;
let n = 0;

function txn(o: Partial<YnabTransaction>): YnabTransaction {
  n += 1;
  return {
    id: `t${n}`,
    date: "2026-09-05",
    amount: -100 * K,
    memo: null,
    payee_name: "Shop",
    category_id: "groc",
    category_name: "Groceries",
    account_id: "main",
    account_name: "Main",
    transfer_account_id: null,
    deleted: false,
    ...o,
  };
}

function item(date: string, amount: number, categoryId = "groc", extra: Partial<SpendItem> = {}): SpendItem {
  return { date, amount: amount * K, categoryId, categoryName: categoryId, accountId: "main", installment: false, ...extra };
}

describe("spendItems", () => {
  it("keeps real spending, splits each part, and leaves out transfers and Ready to Assign", () => {
    const items = spendItems([
      txn({ amount: -50 * K }),
      txn({ amount: 20 * K }), // refund: reduces spending
      txn({ transfer_account_id: "card", category_id: null, category_name: null }),
      txn({ amount: -30 * K, category_name: "Inflow: Ready to Assign", category_id: "rta" }),
      txn({ amount: 5000 * K, category_name: "Inflow: Ready to Assign", category_id: "rta" }),
      txn({ amount: -70 * K, category_id: null, category_name: null }),
      txn({
        amount: -300 * K,
        category_name: "Split",
        subtransactions: [
          { amount: -200 * K, category_id: "ballet", category_name: "Ballet", transfer_account_id: null, deleted: false },
          { amount: -100 * K, category_id: "groc", category_name: "Groceries", transfer_account_id: null, deleted: false },
        ],
      }),
      txn({ deleted: true }),
    ]);
    expect(items.map((i) => [i.categoryName, i.amount / K])).toEqual([
      ["Groceries", 50],
      ["Groceries", -20],
      ["Uncategorized", 70],
      ["Ballet", 200],
      ["Groceries", 100],
    ]);
  });

  it("marks installment charges", () => {
    expect(spendItems([txn({ memo: JSON.stringify({ installment: "2/10" }) })])[0].installment).toBe(true);
  });
});

describe("pastMonths", () => {
  it("lists full months before today's month, newest first, across a year end", () => {
    expect(pastMonths("2027-02-10", 3)).toEqual(["2027-01", "2026-12", "2026-11"]);
  });
});

describe("pace", () => {
  // Normal: 500 by day 5, 1,000 by month end, from 3 purchases a month (so not a fixed payment).
  const history = ["2026-07", "2026-08", "2026-09"].flatMap((m) => [item(`${m}-03`, 300), item(`${m}-04`, 200), item(`${m}-20`, 500)]);

  it("compares with normal spending up to the same day, not a straight line", () => {
    const over = pace([...history, item("2026-10-04", 800)], "2026-10-05", 3, "Groceries");
    expect(over).toMatchObject({ normalMonth: 1000 * K, normalByToday: 500 * K, thisMonth: 800 * K, status: "over" });
    expect(over.difference).toBeCloseTo(0.6);
    expect(pace([...history, item("2026-10-04", 520)], "2026-10-05", 3, "G").status).toBe("on");
    expect(pace([...history, item("2026-10-04", 200)], "2026-10-05", 3, "G").status).toBe("under");
  });

  it("needs ₪200 over normal before it says over, so small amounts do not give huge percentages", () => {
    const small = ["2026-07", "2026-08", "2026-09"].flatMap((m) => [item(`${m}-02`, 30), item(`${m}-03`, 20), item(`${m}-25`, 50)]);
    const result = pace([...small, item("2026-10-04", 240)], "2026-10-05", 3, "Clothing");
    expect(result.difference).toBeCloseTo(3.8);
    expect(result.status).toBe("on");
  });

  it("shows a one-payment category as paid or due, even when a month has 2 payments", () => {
    const rent = [item("2026-07-06", 5500, "rent"), item("2026-08-06", 3000, "rent"), item("2026-08-07", 2500, "rent"), item("2026-09-06", 5500, "rent")];
    expect(pace(rent, "2026-10-04", 3, "Rent").status).toBe("fixed-due");
    expect(pace([...rent, item("2026-10-06", 5500, "rent")], "2026-10-08", 3, "Rent").status).toBe("fixed-paid");
  });

  it("lists the categories most over pace, and keeps uncategorized apart", () => {
    const b = baseline(
      [...history, item("2026-10-04", 800), item("2026-10-02", 250, "fun"), item("2026-10-03", 900, "Uncategorized")],
      "2026-10-05",
      3
    );
    expect(b.asOf).toBe("2026-10-05");
    expect(b.total.thisMonth).toBe(1950 * K);
    expect(b.topOver.map((p) => p.name)).toEqual(["groc", "fun"]);
    expect(b.categories.map((p) => p.name)).not.toContain("Uncategorized");
    expect(b.uncategorized).toBe(900 * K);
  });
});

describe("expected rest of the period", () => {
  const history = ["2026-07", "2026-08", "2026-09"].flatMap((m, i) => [
    item(`${m}-03`, 100),
    item(`${m}-20`, 200 + i * 10),
    item(`${m}-28`, 50),
  ]);

  it("is the median spending in the same days of past months", () => {
    // Days 6-31: 250, 260, 270 -> median 260.
    expect(expectedRest(history, "2026-10-05", "2026-10-31", 3)).toBe(260 * K);
    // Days 6-21 only.
    expect(expectedRest(history, "2026-10-05", "2026-10-21", 3)).toBe(210 * K);
  });

  it("follows a period that crosses into the next month", () => {
    // From day 25 of each month to day 3 of the next: 50 + next month's 100 (September has no next month in history).
    expect(expectedRest(history, "2026-10-25", "2026-11-03", 3)).toBe(150 * K);
  });

  it("leaves out installments and scheduled payments, which left-to-spend already counts", () => {
    const items = [
      item("2026-09-06", 5500, "rent"),
      item("2026-09-10", 135, "course", { installment: true }),
      item("2026-09-12", 80),
    ];
    const kept = predictItems(items, [{ date_next: "2026-10-07", amount: -5500 * K, account_id: "main", category_id: "rent", category_name: "rent", deleted: false }]);
    expect(kept.map((i) => i.amount / K)).toEqual([80]);
  });

  it("does not leave out a charge based on matching account, amount, and day alone", () => {
    const unrelated = item("2026-09-06", 5500, "rent", { payeeName: "School" });
    const schedule = {
      date_next: "2026-10-07",
      amount: -5500 * K,
      account_id: "main",
      category_id: "school-fees",
      category_name: "School fees",
      payee_name: "School Board",
      deleted: false,
    };
    expect(predictItems([unrelated], [schedule])).toEqual([unrelated]);
  });

  it("matches a scheduled payment by similar payee despite a different category", () => {
    const charge = item("2026-09-06", 5500, "rent", { payeeName: "Israel Electric" });
    const schedule = {
      date_next: "2026-10-07",
      amount: -5500 * K,
      account_id: "main",
      category_id: "utilities",
      category_name: "Utilities",
      payee_name: "Israel Electric Corporation",
      deleted: false,
    };
    expect(predictItems([charge], [schedule])).toEqual([]);
  });

  it("does not match a different named payee just because it has the same category", () => {
    const unrelated = item("2026-09-06", 5500, "rent", { payeeName: "School" });
    const schedule = {
      date_next: "2026-10-07",
      amount: -5500 * K,
      account_id: "main",
      category_id: "rent",
      category_name: "Rent",
      payee_name: "Landlord",
      deleted: false,
    };
    expect(predictItems([unrelated], [schedule])).toEqual([unrelated]);
  });
});
