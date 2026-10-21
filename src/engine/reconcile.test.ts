import { describe, expect, it } from "vitest";
import type { YnabTransaction } from "../ynab/categorize.js";
import { balanceSinceReconcile, missingItems, reconcile, type ScrapeRun } from "./reconcile.js";

const SRC = "Max - 1234";
const row = (date: string, outflow: string, payee = "Shop") => ({
  date,
  payee,
  memo: JSON.stringify({ source: SRC }),
  outflow,
  inflow: "",
});
let n = 0;
const txn = (date: string, shekels: number, o: Partial<YnabTransaction> = {}): YnabTransaction => ({
  id: `t${++n}`,
  date,
  amount: -shekels * 1000,
  memo: null,
  payee_name: "Shop",
  category_id: null,
  category_name: null,
  account_id: "acc",
  account_name: "Max",
  transfer_account_id: null,
  import_id: "YNAB:x",
  deleted: false,
  ...o,
});
const run = (createdAt: string, daysBack: number, rows: ScrapeRun["rows"]): ScrapeRun => ({ createdAt, daysBack, rows });

describe("reconcile", () => {
  it("matches by amount and near date, and lists leftovers on both sides", () => {
    const runs = [run("2026-10-30T10:00:00Z", 29, [row("2026-10-10", "50.00"), row("2026-10-15", "80.00")])];
    const ynab = [txn("2026-10-12", 50), txn("2026-10-20", 99), txn("2026-10-20", 30, { deleted: true })];
    const [r] = reconcile(runs, ynab, { [SRC]: "acc" });
    expect(r.matched).toBe(1);
    expect(r.missingInYnab.map((b) => b.amount)).toEqual([-80000]);
    expect(r.missingInBank.map((t) => t.amount)).toEqual([-99000]);
    expect([r.from, r.to]).toEqual(["2026-10-04", "2026-10-27"]);
  });

  it("counts a row seen by two overlapping runs once, but keeps two real equal charges", () => {
    const runs = [
      run("2026-10-20T10:00:00Z", 15, [row("2026-10-10", "20.00"), row("2026-10-10", "20.00")]),
      run("2026-10-25T10:00:00Z", 15, [row("2026-10-10", "20.00", "Shop v2"), row("2026-10-10", "20.00", "Shop v2")]),
    ];
    const [r] = reconcile(runs, [txn("2026-10-10", 20)], { [SRC]: "acc" });
    expect(r.matched).toBe(1);
    expect(r.missingInYnab).toHaveLength(1);
  });

  it("ignores rows at the window edges, the card side of a transfer, and unmapped sources", () => {
    const runs = [run("2026-10-30T10:00:00Z", 20, [row("2026-10-11", "10.00"), row("2026-10-20", "10.00")])];
    const ynab = [txn("2026-10-29", 5), txn("2026-10-20", 10), txn("2026-10-18", 900, { transfer_account_id: "bank", import_id: null })];
    const [r] = reconcile(runs, ynab, { [SRC]: "acc" });
    expect(r.missingInYnab).toEqual([]);
    expect(r.missingInBank).toEqual([]);
    expect(reconcile(runs, ynab, {})).toEqual([]);
  });
});

describe("missingItems", () => {
  it("makes cards for both sides, without ₪0 rows, reconcile adjustments, or a full charge YNAB has as a credit deal", () => {
    const runs = [run("2026-10-30T10:00:00Z", 29, [row("2026-10-13", "30.00", "Suite"), row("2026-10-12", "1436.10", "City")])];
    const deal = txn("2026-10-14", 294.62, { payee_name: "City", memo: JSON.stringify({ installment: "1/5", originalAmount: -1436.1 }) });
    const extra = txn("2026-10-20", 99);
    const ynab = [deal, extra, txn("2026-10-14", 0, { payee_name: "Starting Balance" }), txn("2026-10-16", 22.14, { payee_name: "Reconciliation Balance Adjustment" })];
    const items = missingItems(reconcile(runs, ynab, { [SRC]: "acc" }), ynab);
    expect(items.map((i) => [i.side, i.payee, i.amount])).toEqual([
      ["not-in-bank", "Shop", -99000],
      ["not-in-bank", "City", -294620],
      ["not-in-ynab", "Suite", -30000],
    ]);
    expect(items[2].id).toBe(`missing-ynab:${SRC}:2026-10-13:-30000:1`);
    expect(missingItems(reconcile(runs, ynab, { [SRC]: "acc" }), ynab, [`missing-bank:${extra.id}`])).toHaveLength(2);
  });
});

describe("balanceSinceReconcile", () => {
  const ynab = [
    txn("2026-07-01", 100, { cleared: "reconciled" }),
    txn("2026-07-02", -1000, { cleared: "reconciled" }),
    txn("2026-07-05", 50, { cleared: "cleared" }),
  ];
  const b = (date: string, shekels: number) => ({ date, amount: shekels * 1000, payee: "x" });
  const rows = [b("2026-07-02", 1000), b("2026-07-05", -50), b("2026-07-10", -30)];

  it("adds scraped rows since the last reconcile, without the rows already reconciled", () => {
    const r = balanceSinceReconcile({ from: "2026-06-30", to: "2026-07-14", rows }, ynab);
    expect(r).toMatchObject({ reconciledDate: "2026-07-02", reconciledBalance: 900000, scrapeTotal: -80000, scrapeRows: 2 });
    expect(r.expected).toBe(820000);
    expect(r.ynabBalance).toBe(850000);
  });

  it("gives no number when the scrapes start after the reconcile or miss card payments", () => {
    const late = balanceSinceReconcile({ from: "2026-07-04", to: "2026-07-14", rows }, ynab);
    expect(late.expected).toBeNull();
    expect(late.note).toContain("15 days back");
    const card = [...ynab, txn("2026-07-08", -500, { transfer_account_id: "bank", import_id: null })];
    expect(balanceSinceReconcile({ from: "2026-06-30", to: "2026-07-14", rows }, card).expected).toBeNull();
  });
});
