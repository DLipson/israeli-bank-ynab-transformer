import { describe, expect, it } from "vitest";
import type { YnabTransaction } from "../ynab/categorize.js";
import {
  creditExposure,
  DEFAULT_SETTINGS,
  installmentPlans,
  leftCashflow,
  leftYnab,
  obligations,
  occurrences,
  periodEndDate,
  suggestScheduled,
  type Account,
  type ScheduledTransaction,
  type Snapshot,
} from "./safe-spending.js";

const K = 1000; // milliunits per shekel

function account(id: string, type: string, balance: number, name = id): Account {
  return { id, name, type, balance: balance * K, on_budget: true, closed: false, deleted: false };
}

let n = 0;
function txn(o: Partial<YnabTransaction>): YnabTransaction {
  n += 1;
  return {
    id: `t${n}`,
    date: "2026-09-01",
    amount: -100 * K,
    memo: null,
    payee_name: "Shop",
    category_id: "cat",
    category_name: "Cat",
    account_id: "main",
    account_name: "Main",
    transfer_account_id: null,
    deleted: false,
    ...o,
  };
}

function scheduled(o: Partial<ScheduledTransaction>): ScheduledTransaction {
  return {
    id: "s1",
    date_next: "2026-10-20",
    frequency: "monthly",
    amount: -500 * K,
    account_id: "main",
    payee_name: "Rent",
    category_name: "Rent",
    deleted: false,
    ...o,
  };
}

function snapshot(o: Partial<Snapshot> = {}): Snapshot {
  return {
    today: "2026-10-11",
    accounts: [
      account("main", "checking", -20000, "Main Account"),
      account("second", "checking", 14000, "Second Account"),
      account("limit", "checking", 40000, "Credit Limit"),
      account("leumi", "creditCard", -1300, "Leumi Cards"),
      account("max", "creditCard", -200, "Max Card"),
      account("cal", "creditCard", 200, "Cal"),
    ],
    month: { month: "2026-10-01", to_be_budgeted: 30000 * K, categories: [] },
    transactions: [],
    scheduled: [],
    settings: { ...DEFAULT_SETTINGS, overdraft: { limitAccountId: "limit", accountId: "main" } },
    ...o,
  };
}

describe("dates", () => {
  it("ends the period at month end or at the next chosen day", () => {
    expect(periodEndDate("2026-10-11", "month-end")).toBe("2026-10-31");
    expect(periodEndDate("2026-10-11", 20)).toBe("2026-10-20");
    expect(periodEndDate("2026-10-25", 20)).toBe("2026-11-20");
    expect(periodEndDate("2027-01-31", 31)).toBe("2027-01-31");
  });

  it("expands scheduled frequencies and clamps day 31 to short months", () => {
    expect(occurrences({ date_next: "2026-10-31", frequency: "monthly" }, "2027-01-31")).toEqual([
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
      "2027-01-31",
    ]);
    expect(occurrences({ date_next: "2026-10-12", frequency: "weekly" }, "2026-10-31")).toEqual([
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
    ]);
    expect(occurrences({ date_next: "2026-10-12", frequency: "never" }, "2027-10-31")).toEqual(["2026-10-12"]);
  });
});

describe("leftCashflow", () => {
  it("counts the overdraft and card balances, and subtracts scheduled outflows up to period end and the buffer", () => {
    const result = leftCashflow(
      snapshot({
        scheduled: [
          scheduled({ date_next: "2026-10-20", amount: -500 * K, payee_name: "Rent" }),
          scheduled({ id: "s2", date_next: "2026-11-02", amount: -999 * K }),
          scheduled({ id: "s3", date_next: "2026-10-25", amount: 5000 * K, payee_name: "Salary" }),
        ],
        settings: { ...snapshot().settings, buffer: 100 * K },
      })
    );
    // -20000 + 14000 + 40000 - 1300 - 200 + 200 - 500 - 100
    expect(result.total).toBe(32100 * K);
    expect(result.lines.map((l) => l.label)).toContain("Rent (scheduled, 2026-10-20)");
    expect(result.warnings).toEqual([]);
  });

  it("warns when nothing is scheduled", () => {
    expect(leftCashflow(snapshot()).warnings[0]).toContain("No scheduled transactions");
  });
});

describe("leftYnab", () => {
  it("sums Available of the chosen categories by group and warns about Ready to Assign", () => {
    const month = {
      month: "2026-10-01",
      to_be_budgeted: 30000 * K,
      categories: [
        { id: "g", name: "Groceries", category_group_name: "Food", balance: 500 * K, hidden: false, deleted: false },
        { id: "d", name: "Dining", category_group_name: "Food", balance: -100 * K, hidden: false, deleted: false },
        { id: "r", name: "Rent", category_group_name: "Home", balance: 5500 * K, hidden: false, deleted: false },
        { id: "c", name: "Leumi", category_group_name: "Credit Card Payments", balance: -700 * K, hidden: false, deleted: false },
      ],
    };
    expect(leftYnab(snapshot({ month })).total).toBe(5900 * K);
    const flexible = leftYnab(snapshot({ month, settings: { ...snapshot().settings, flexibleCategoryIds: ["g", "d"] } }));
    expect(flexible.total).toBe(400 * K);
    expect(flexible.warnings[0]).toContain("₪30,000 is in Ready to Assign");
  });
});

describe("installments, credit exposure, and obligations", () => {
  const plan = (paid: number, chargeDate: string, account_id = "leumi") =>
    txn({
      account_id,
      payee_name: "Course",
      amount: -135 * K,
      memo: JSON.stringify({ installment: `${paid}/10`, chargeDate, originalAmount: -1350 }),
    });

  it("keeps the latest payment of each plan and drops plans not charged lately", () => {
    const plans = installmentPlans(
      [plan(1, "2026-10-02"), plan(2, "2026-11-02"), txn({ memo: JSON.stringify({ installment: "3/5", chargeDate: "2026-01-02" }) })],
      "2026-10-11"
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ paid: 2, total: 10, remaining: 8 * 135 * K });
  });

  it("groups shared card limits and adds future installments to used credit", () => {
    const s = snapshot({
      transactions: [plan(2, "2026-11-02")],
      settings: { ...snapshot().settings, creditLimits: [{ name: "Leumi + Max", limit: 20000 * K, accountIds: ["leumi", "max"] }] },
    });
    const groups = creditExposure(s);
    expect(groups.map((g) => g.name)).toEqual(["Overdraft", "Leumi + Max", "Cal"]);
    expect(groups[0]).toMatchObject({ limit: 40000 * K, used: 20000 * K, unused: 20000 * K });
    // 1300 + 200 balances + 8 x 135 future installments
    expect(groups[1]).toMatchObject({ used: 2580 * K, unused: 17420 * K });
    expect(groups[2]).toMatchObject({ limit: null, unused: null });
  });

  it("lists installments not yet in a card balance plus scheduled outflows, per month", () => {
    const result = obligations(snapshot({ transactions: [plan(2, "2026-11-02")], scheduled: [scheduled({ date_next: "2026-11-06" })] }), 3);
    expect(result).toEqual([
      { month: "2026-11", installments: 0, scheduled: 500 * K, total: 500 * K },
      { month: "2026-12", installments: 135 * K, scheduled: 500 * K, total: 635 * K },
      { month: "2027-01", installments: 135 * K, scheduled: 500 * K, total: 635 * K },
    ]);
  });
});

describe("suggestScheduled", () => {
  const history = (o: Partial<YnabTransaction>, months = ["2026-06", "2026-07", "2026-08", "2026-09"], day = "06") =>
    months.map((m) => txn({ date: `${m}-${day}`, ...o }));

  it("suggests a monthly payment with its usual category and next date", () => {
    const [s] = suggestScheduled(snapshot({ transactions: history({ payee_name: "Rent", amount: -5500 * K, category_id: "rent" }) }));
    expect(s).toMatchObject({ label: "Rent", amount: 5500 * K, dayOfMonth: 6, nextDate: "2026-11-06", categoryId: "rent", amountVaries: false });
  });

  it("skips payments already scheduled, ignored, irregular, cash, or installments", () => {
    const rent = history({ payee_name: "Rent", amount: -5500 * K });
    expect(suggestScheduled(snapshot({ transactions: rent, scheduled: [scheduled({ date_next: "2026-11-07", amount: -5500 * K })] }))).toEqual([]);
    expect(suggestScheduled(snapshot({ transactions: rent, settings: { ...snapshot().settings, ignoredSuggestions: ["main|rent"] } }))).toEqual([]);
    expect(suggestScheduled(snapshot({ transactions: history({ payee_name: "Rare" }, ["2026-08", "2026-09"]) }))).toEqual([]);
    expect(suggestScheduled(snapshot({ transactions: history({ payee_name: "משיכת מזומן" }) }))).toEqual([]);
    expect(suggestScheduled(snapshot({ transactions: history({ payee_name: "Course", memo: JSON.stringify({ installment: "2/10" }) }) }))).toEqual([]);
  });

  it("does not let a non-monthly schedule hide a monthly payment suggestion", () => {
    const transactions = history({ payee_name: "Rent", amount: -5500 * K });
    const schedule = scheduled({ frequency: "yearly", amount: -5500 * K });
    expect(suggestScheduled(snapshot({ transactions, scheduled: [schedule] }))).toHaveLength(1);
  });

  it("flags amounts that vary, because YNAB matches imports only on the exact amount", () => {
    const transactions = [-80, -83, -85, -83].map((a, i) => txn({ payee_name: "Phone", amount: a * K, date: `2026-0${6 + i}-07` }));
    expect(suggestScheduled(snapshot({ transactions }))[0]).toMatchObject({ amount: 83 * K, amountVaries: true });
  });
});
