import { describe, expect, it } from "vitest";
import type { YnabTransaction } from "../ynab/categorize.js";
import { parseChargeDate } from "./charge-date.js";
import {
  creditExposure,
  DEFAULT_SETTINGS,
  installmentPlans,
  leftCashflow,
  leftYnab,
  obligations,
  occurrences,
  periodEndDate,
  paydayFromPeriodEnd,
  settingsFromSaved,
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
    settings: { ...DEFAULT_SETTINGS },
    ...o,
  };
}

function expectLineSum(result: ReturnType<typeof leftCashflow>) {
  expect(result.total).toBe(result.lines.reduce((sum, line) => sum + line.amount, 0));
}

describe("dates", () => {
  it("parses charge dates in both memo formats and rejects missing or invalid values", () => {
    expect(parseChargeDate(JSON.stringify({ chargeDate: "10/06/2025" }))).toBe("2025-06-10");
    expect(parseChargeDate("{ chargeDate: '10/06/2025' }")).toBe("2025-06-10");
    expect(parseChargeDate(JSON.stringify({ chargeDate: "2026-11-02" }))).toBe("2026-11-02");
    expect(parseChargeDate(JSON.stringify({}))).toBeNull();
    expect(parseChargeDate(JSON.stringify({ chargeDate: "31/02/2025" }))).toBeNull();
    expect(parseChargeDate("not a memo")).toBeNull();
  });

  it("ends the period the day before payday", () => {
    expect(periodEndDate("2026-10-11", "month-start")).toBe("2026-10-31");
    expect(periodEndDate("2026-10-11", 21)).toBe("2026-10-20");
    expect(periodEndDate("2026-10-25", 21)).toBe("2026-11-20");
    expect(periodEndDate("2026-10-01", 1)).toBe("2026-10-31");
    // payday 30 is clamped to 28 Feb, so on 28 Feb the next payday is 30 Mar.
    expect(periodEndDate("2027-02-20", 30)).toBe("2027-02-27");
    expect(periodEndDate("2027-02-28", 30)).toBe("2027-03-29");
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
  it("counts cash and card balances, and subtracts bills up to period end and the buffer", () => {
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
    expectLineSum(result);
    expect(result.lines.find((line) => line.key === "bills")?.items).toContainEqual({
      label: "Rent",
      amount: -500 * K,
      date: "2026-10-20",
    });
    expect(result.lines.find((line) => line.key === "buffer")?.items).toEqual([
      { label: "Buffer", amount: -100 * K },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("includes savings and cash accounts in the cash line", () => {
    const base = snapshot();
    const result = leftCashflow(snapshot({ accounts: [...base.accounts, account("savings", "savings", 900), account("wallet", "cash", 100)] }));
    expect(result.lines.find((line) => line.key === "cash")?.amount).toBe(35000 * K);
    expectLineSum(result);
  });

  it("warns when nothing is scheduled", () => {
    const result = leftCashflow(snapshot());
    expect(result.warnings[0]).toContain("No scheduled transactions");
    expectLineSum(result);
  });
});

describe("leftYnab", () => {
  it("sums Available of the chosen categories by group and warns about Ready to Assign", () => {
    const month = {
      month: "2026-10-01",
      to_be_budgeted: 30000 * K,
      categories: [
        { id: "g", name: "Groceries", category_group_name: "Food", balance: 500 * K, budgeted: 600 * K, hidden: false, deleted: false },
        { id: "d", name: "Dining", category_group_name: "Food", balance: -100 * K, budgeted: 0, hidden: false, deleted: false },
        { id: "r", name: "Rent", category_group_name: "Home", balance: 5500 * K, budgeted: 5500 * K, hidden: false, deleted: false },
        { id: "c", name: "Leumi", category_group_name: "Credit Card Payments", balance: -700 * K, budgeted: 0, hidden: false, deleted: false },
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

  it("counts only the principal left of a credit deal with interest, as the bank does", () => {
    // Real Cal charge: ₪2,138.45 in 12 payments of ₪191.50; the bank counted ₪135.49 less than 11 × 191.50.
    const credit = txn({ amount: -191.5 * K, memo: JSON.stringify({ installment: "1/12", chargeDate: "2026-11-02", originalAmount: -2138.45 }) });
    const [p] = installmentPlans([credit, plan(2, "2026-11-02")], "2026-10-20").filter((x) => x.total === 12);
    expect(p.remaining).toBe(2106.5 * K);
    expect(Math.abs(p.principalLeft - 1971 * K)).toBeLessThan(K);
    expect(installmentPlans([plan(2, "2026-11-02")], "2026-10-20")[0].principalLeft).toBe(8 * 135 * K);
  });

  it("parses an old-format charge date in an installment memo", () => {
    const plans = installmentPlans(
      [txn({ memo: "{ installment: '2/10', chargeDate: '10/06/2025' }" })],
      "2025-06-15"
    );
    expect(plans[0]?.lastCharge).toBe("2025-06-10");
  });

  it("groups shared card limits and adds future installments to used credit", () => {
    const s = snapshot({
      transactions: [plan(2, "2026-11-02")],
      settings: { ...snapshot().settings, creditLimits: [{ name: "Leumi + Max", limit: 20000 * K, accountIds: ["leumi", "max"] }] },
    });
    const groups = creditExposure(s);
    expect(groups.map((g) => g.name)).toEqual(["Leumi + Max", "Cal"]);
    // 1300 + 200 balances + 8 x 135 future installments
    expect(groups[0]).toMatchObject({ used: 2580 * K, unused: 17420 * K });
    expect(groups[1]).toMatchObject({ limit: null, unused: null });
  });

  it("lists installments not yet in a card balance plus scheduled outflows, per month", () => {
    const result = obligations(
      snapshot({
        transactions: [plan(2, "2026-11-02")],
        scheduled: [scheduled({ date_next: "2026-11-06" }), scheduled({ id: "card", payee_name: "Card payment", transfer_account_id: "leumi" })],
      }),
      3
    );
    expect(result.map(({ items: _items, ...totals }) => totals)).toEqual([
      { month: "2026-11", installments: 0, scheduled: 500 * K, total: 500 * K },
      { month: "2026-12", installments: 135 * K, scheduled: 500 * K, total: 635 * K },
      { month: "2027-01", installments: 135 * K, scheduled: 500 * K, total: 635 * K },
    ]);
    // The items behind each month; a scheduled transfer (card payment) is not a bill.
    expect(result[1].items).toEqual({
      scheduled: [{ label: "Rent", date: "2026-12-06", amount: 500 * K }],
      installments: [{ payee: "Course", account: "Leumi Cards", payment: 135 * K, paymentsLeft: 8 }],
    });
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


describe("settings migration", () => {
  it("moves old settings to payday and drops removed settings without migrating flexible categories", () => {
    expect(paydayFromPeriodEnd("month-end")).toBe("month-start");
    expect(paydayFromPeriodEnd(20)).toBe(21);
    expect(paydayFromPeriodEnd(28)).toBe(29);
    expect(paydayFromPeriodEnd(30)).toBe(31);
    expect(paydayFromPeriodEnd(31)).toBe("month-start");
    const saved = JSON.parse(JSON.stringify({
      periodEnd: 20,
      overdraft: { limitAccountId: "limit", accountId: "main" },
      subtractExpected: false,
      flexibleCategoryIds: ["clothing", "groceries"],
    }));
    const settings = settingsFromSaved(saved);
    expect(settings).toMatchObject({
      payday: 21,
      essentialCategoryIds: [],
      flexibleCategoryIds: ["clothing", "groceries"],
    });
    expect(settings).not.toHaveProperty("periodEnd");
    expect(settings).not.toHaveProperty("overdraft");
    expect(settings).not.toHaveProperty("subtractExpected");
  });
});

describe("available until payday", () => {
  const category = (id: string, name: string, budgeted = 0) => ({
    id,
    name,
    category_group_name: "Daily",
    budgeted,
    balance: 0,
    hidden: false,
    deleted: false,
  });

  it("returns the five ordered lines and flags unchosen essentials", () => {
    const result = leftCashflow(snapshot());
    expect(result.lines.map((line) => line.key)).toEqual(["cash", "cards", "bills", "essentials", "buffer"]);
    expect(result.lines.find((line) => line.key === "essentials")).toMatchObject({ amount: 0, items: [] });
    expect(result.essentialsNotChosen).toBe(true);
    expectLineSum(result);
  });

  it("uses assigned money minus this month's category spending", () => {
    const result = leftCashflow(snapshot({
      month: { month: "2026-10-01", to_be_budgeted: 0, categories: [category("food", "Food", 500 * K)] },
      transactions: [txn({ date: "2026-10-04", category_id: "food", category_name: "Food", amount: -100 * K })],
      settings: { ...snapshot().settings, essentialCategoryIds: ["food"] },
    }));
    expect(result.lines.find((line) => line.key === "essentials")).toMatchObject({
      amount: -400 * K,
      items: [{ label: "Food", amount: -400 * K, categoryId: "food", assigned: 500 * K }],
    });
    expectLineSum(result);
  });

  it("uses normal spending for only unassigned essential categories", () => {
    const history = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].flatMap((month) => [
      txn({ date: `${month}-15`, category_id: "food", category_name: "Food", amount: -50 * K }),
      txn({ date: `${month}-15`, category_id: "travel", category_name: "Travel", amount: -700 * K }),
    ]);
    const result = leftCashflow(snapshot({
      month: { month: "2026-10-01", to_be_budgeted: 0, categories: [category("food", "Food"), category("travel", "Travel")] },
      transactions: history,
      settings: { ...snapshot().settings, essentialCategoryIds: ["food"] },
    }));
    expect(result.lines.find((line) => line.key === "essentials")).toMatchObject({ amount: -50 * K });
    expectLineSum(result);
  });

  it("matches a similar payee within the 25% amount and five-day limits", () => {
    const result = leftCashflow(snapshot({
      transactions: [
        txn({ date: "2026-10-25", account_id: "main", payee_name: "Phone bill Oct", amount: -125 * K }),
        txn({ date: "2026-10-25", account_id: "main", payee_name: "Near", amount: -126 * K }),
        txn({ date: "2026-10-25", account_id: "main", payee_name: "Wrong account", amount: -100 * K }),
        txn({ date: "2026-10-20", account_id: "main", payee_name: "Utilities", amount: -300 * K, transfer_account_id: "second" }),
      ],
      scheduled: [
        scheduled({ id: "phone", payee_name: "Phone bill", amount: -100 * K }),
        scheduled({ id: "near", payee_name: "Near", amount: -100 * K }),
        scheduled({ id: "wrong-account", account_id: "second", payee_name: "Wrong account", amount: -100 * K }),
        scheduled({ id: "utilities", payee_name: "Utilities", amount: -300 * K }),
      ],
    }));
    expect(result.lines.find((line) => line.key === "bills")?.items).toEqual([
      { label: "Near", amount: -100 * K, date: "2026-10-20" },
      { label: "Wrong account", amount: -100 * K, date: "2026-10-20" },
      { label: "Utilities", amount: -300 * K, date: "2026-10-20" },
    ]);
    expectLineSum(result);
  });

  it("uses only the override for this period and otherwise falls back to the calculation", () => {
    const base = {
      month: { month: "2026-10-01", to_be_budgeted: 0, categories: [category("food", "Food", 500 * K)] },
      transactions: [txn({ date: "2026-10-04", category_id: "food", category_name: "Food", amount: -100 * K })],
      settings: {
        ...snapshot().settings,
        essentialCategoryIds: ["food"],
        essentialsOverride: { period: "2026-10-31", amounts: { food: 25 * K } },
      },
    };
    const current = leftCashflow(snapshot(base));
    expect(current.lines.find((line) => line.key === "essentials")?.amount).toBe(-25 * K);
    expect(current.essentialsOverridden).toBe(true);
    expectLineSum(current);
    const old = leftCashflow(snapshot({ ...base, settings: { ...base.settings, essentialsOverride: { period: "2026-09-30", amounts: { food: 25 * K } } } }));
    expect(old.lines.find((line) => line.key === "essentials")?.amount).toBe(-400 * K);
    expect(old.essentialsOverridden).toBe(false);
    expectLineSum(old);
    const partial = leftCashflow(snapshot({ ...base, settings: { ...base.settings, essentialsOverride: { period: "2026-10-31", amounts: {} } } }));
    expect(partial.lines.find((line) => line.key === "essentials")?.amount).toBe(-400 * K);
    expect(partial.essentialsOverridden).toBe(false);
    expectLineSum(partial);
  });

  it("excludes transfers, dates outside the period, and schedules already in the same account balance", () => {
    const result = leftCashflow(snapshot({
      transactions: [txn({ date: "2026-10-22", account_id: "main", payee_name: "Rent", amount: -500 * K })],
      scheduled: [
        scheduled({ id: "transfer", payee_name: "Transfer", transfer_account_id: "second" }),
        scheduled({ id: "before", date_next: "2026-10-10", payee_name: "Before" }),
        scheduled({ id: "today", date_next: "2026-10-11", amount: -25 * K, payee_name: "Today" }),
        scheduled({ id: "duplicate", date_next: "2026-10-20", payee_name: "Rent", amount: -500 * K }),
        scheduled({ id: "after", date_next: "2026-11-01", payee_name: "After" }),
        scheduled({ id: "card", date_next: "2026-10-31", account_id: "leumi", payee_name: "Card charge", amount: -300 * K }),
      ],
    }));
    const bills = result.lines.find((line) => line.key === "bills");
    expect(bills?.amount).toBe(-325 * K);
    expect(bills?.items).toEqual([
      { label: "Today", amount: -25 * K, date: "2026-10-11" },
      { label: "Card charge", amount: -300 * K, date: "2026-10-31" },
    ]);
    expectLineSum(result);
  });

  it("lets one posted transaction clear only one of two duplicate schedules", () => {
    const result = leftCashflow(snapshot({
      transactions: [txn({ date: "2026-10-20", account_id: "main", payee_name: "Rescue", amount: -30 * K })],
      scheduled: [
        scheduled({ id: "a", date_next: "2026-10-20", payee_name: "Rescue", amount: -30 * K }),
        scheduled({ id: "b", date_next: "2026-10-20", payee_name: "Rescue", amount: -30 * K }),
      ],
    }));
    expect(result.lines.find((line) => line.key === "bills")?.items).toEqual([
      { label: "Rescue", amount: -30 * K, date: "2026-10-20" },
    ]);
    expectLineSum(result);
  });
});
