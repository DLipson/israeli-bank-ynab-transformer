import { describe, expect, it } from "vitest";
import type { YnabTransaction } from "../ynab/categorize.js";
import { cardGroups, watchItems } from "./cards.js";
import { DEFAULT_SETTINGS, type Account, type Snapshot } from "./safe-spending.js";

const K = 1000;
let nextId = 0;

function account(id: string, balance: number, type = "creditCard"): Account {
  return { id, name: id, type, balance: balance * K, on_budget: true, closed: false, deleted: false };
}

function txn(accountId: string, date: string, amount: number, memo: object | string | null, overrides: Partial<YnabTransaction> = {}): YnabTransaction {
  return {
    id: `t${nextId++}`,
    date,
    amount: amount * K,
    memo: memo === null || typeof memo === "string" ? memo : JSON.stringify(memo),
    payee_name: `shop ${nextId}`,
    category_id: "c",
    category_name: "C",
    account_id: accountId,
    account_name: accountId,
    transfer_account_id: null,
    deleted: false,
    ...overrides,
  };
}

const payment = (accountId: string, date: string, amount: number) =>
  txn(accountId, date, amount, { chargeDate: date }, { transfer_account_id: "main", category_id: null, category_name: null });

/** Isracard: ISO chargeDate. Paid on 2 Oct; the balance is the 2 Nov charge. */
const isracard = [
  payment("isracard", "2026-10-02", 7577),
  txn("isracard", "2026-09-20", -500, { chargeDate: "2026-10-02" }),
  txn("isracard", "2026-10-05", -300, { chargeDate: "2026-11-02" }),
  txn("isracard", "2026-10-08", -100, { chargeDate: "2026-11-02", installment: "1/12", originalAmount: -1200 }),
  txn("isracard", "2026-10-02", -100, { chargeDate: "2026-11-02", installment: "4/12", originalAmount: -1200 }),
  txn("isracard", "2026-10-20", -30, null),
  txn("isracard", "2026-10-14", 0, null, { payee_name: "Starting Balance" }),
];

/** Cal: old dd/mm/yyyy chargeDate in object-text memos. */
const cal = [
  payment("cal", "2026-10-02", 900),
  txn("cal", "2026-10-09", -1900, "{ chargeDate: '02/11/2026' }"),
  txn("cal", "2026-08-09", -200, "{ installment: '3/6', chargeDate: '02/11/2026' }"),
];

function snapshot(calLimit = 2000): Snapshot {
  return {
    today: "2026-10-20",
    accounts: [account("isracard", -530), account("cal", -2100), account("max", -50), account("main", 1000, "checking")],
    month: { month: "2026-10-01", to_be_budgeted: 0, categories: [] },
    transactions: [...isracard, ...cal, txn("max", "2026-10-10", -50, null)],
    scheduled: [],
    settings: {
      ...DEFAULT_SETTINGS,
      creditLimits: [
        { name: "Isracard", limit: 8000 * K, accountIds: ["isracard"] },
        { name: "Cal", limit: calLimit * K, accountIds: ["cal"] },
      ],
    },
  };
}

describe("cardGroups", () => {
  it("splits the Isracard balance into new purchases and older installments (ISO chargeDate)", () => {
    const group = cardGroups(snapshot()).find((g) => g.name === "Isracard")!;
    expect(group).toMatchObject({ limit: 8000 * K, balance: 530 * K, futureInstallments: 1900 * K, headroom: 5570 * K, state: "ok" });
    expect(group.nextPayment.date).toBe("2026-11-02");
    expect(group.nextPayment.olderInstallments.amount).toBe(100 * K);
    expect(group.nextPayment.olderInstallments.items).toEqual([expect.objectContaining({ amount: -100 * K, payment: "4 of 12" })]);
    expect(group.nextPayment.newPurchases.amount).toBe(430 * K);
    expect(group.nextPayment.newPurchases.items.map((i) => i.amount)).toEqual([-30 * K, -100 * K, -300 * K]);
    expect(group.nextPayment.newPurchases.amount + group.nextPayment.olderInstallments.amount).toBe(group.balance);
  });

  it("lists future installments by month, and they add up to the future total", () => {
    const group = cardGroups(snapshot()).find((g) => g.name === "Isracard")!;
    expect(group.futureByMonth[0]).toEqual({
      month: "2026-12",
      amount: 200 * K,
      plans: [
        expect.objectContaining({ payment: 100 * K, paymentsLeft: 11 }),
        expect.objectContaining({ payment: 100 * K, paymentsLeft: 8 }),
      ],
    });
    expect(group.futureByMonth.map((m) => m.month).at(-1)).toBe("2027-10");
    expect(group.futureByMonth.reduce((sum, m) => sum + m.amount, 0)).toBe(group.futureInstallments);
  });

  it("reads the old dd/mm/yyyy chargeDate on Cal and marks a group over its limit", () => {
    const group = cardGroups(snapshot()).find((g) => g.name === "Cal")!;
    expect(group).toMatchObject({ balance: 2100 * K, futureInstallments: 600 * K, headroom: -700 * K, state: "over" });
    expect(group.nextPayment.date).toBe("2026-11-02");
    expect(group.nextPayment.olderInstallments.amount).toBe(200 * K);
    expect(group.nextPayment.newPurchases.amount).toBe(1900 * K);
    expect(group.nextPayment.newPurchases.amount + group.nextPayment.olderInstallments.amount).toBe(group.balance);
  });

  it("is low below the card warning level, and a card with no group has no limit", () => {
    const groups = cardGroups(snapshot(3500));
    expect(groups.find((g) => g.name === "Cal")).toMatchObject({ headroom: 800 * K, state: "low" });
    expect(groups.find((g) => g.name === "max")).toMatchObject({ limit: null, headroom: null, state: "no-limit", balance: 50 * K });
  });

  it("shows the balance not explained by listed charges as its own item, so the split still adds up", () => {
    const s = snapshot();
    s.accounts[0] = account("isracard", -600);
    const group = cardGroups(s).find((g) => g.name === "Isracard")!;
    expect(group.nextPayment.newPurchases.amount).toBe(500 * K);
    expect(group.nextPayment.newPurchases.items).toContainEqual(expect.objectContaining({ payee: "Earlier balance and adjustments", amount: -70 * K }));
    expect(group.unexplained).toBe(-70 * K);
    expect(cardGroups(snapshot()).find((g) => g.name === "Isracard")!.unexplained).toBe(0);
  });

  it("treats a reconcile adjustment as old data, not as a charge", () => {
    const s = snapshot();
    s.accounts[0] = account("isracard", -550);
    s.transactions.push(txn("isracard", "2026-10-16", -20, "Entered automatically by YNAB", { payee_name: "Reconciliation Balance Adjustment" }));
    const group = cardGroups(s).find((g) => g.name === "Isracard")!;
    expect(group.nextPayment.newPurchases.items.some((i) => i.payee === "Reconciliation Balance Adjustment")).toBe(false);
    expect(group.unexplained).toBe(-20 * K);
  });

  it("leaves credit-deal interest out of the headroom", () => {
    const s = snapshot();
    s.transactions.push(txn("cal", "2026-10-03", -191.5, { installment: "1/12", chargeDate: "2026-11-02", originalAmount: -2138.45 }));
    const group = cardGroups(s).find((g) => g.name === "Cal")!;
    expect(group.futureInstallments).toBe(600 * K + 2106.5 * K);
    expect(Math.abs(group.futureInterest - 135.5 * K)).toBeLessThan(K);
    expect(group.headroom).toBe(2000 * K - group.balance - group.futureInstallments + group.futureInterest);
  });
});

describe("watchItems", () => {
  it("lists low and over card groups and essentials over pace, and nothing else", () => {
    const essential = (categoryId: string, thisMonth: number, compareTo: number, type: "essential" | "occasional" = "essential") => ({
      categoryId,
      name: categoryId,
      type,
      thisMonth: thisMonth * K,
      compareTo: compareTo * K,
      compareLabel: "normal by this day" as const,
      difference: (thisMonth - compareTo) * K,
      items: [],
    });
    const groups = cardGroups(snapshot(3500));
    const items = watchItems(groups, [essential("groceries", 900, 500), essential("fuel", 520, 500), essential("clothing", 900, 100, "occasional")]);
    expect(items).toEqual([
      { kind: "card-low", label: "Cal: only ₪800 left", target: { tab: "cards", group: "Cal" } },
      { kind: "essential-over-pace", label: "groceries: ₪400 over the normal by this day", target: { tab: "home", categoryId: "groceries" } },
    ]);
    expect(watchItems(cardGroups(snapshot()), [])).toEqual([
      { kind: "card-over", label: "Cal: ₪700 over the limit", target: { tab: "cards", group: "Cal" } },
    ]);
  });

  it("lists the items the user wants to check, after the cards and essentials", () => {
    const toCheck = [{ id: "dup:1", title: "Possible duplicate: Shop", detail: "2 charges of ₪250 on 2 Oct", date: "2026-10-02", amount: 250 * K }];
    expect(watchItems(cardGroups(snapshot()), [], toCheck).at(-1)).toEqual({
      kind: "to-check",
      label: "To check: Possible duplicate: Shop · 2 charges of ₪250 on 2 Oct",
      target: { tab: "check", id: "dup:1" },
    });
  });
});
