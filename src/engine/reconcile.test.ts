import { describe, expect, it } from "vitest";
import type { YnabTransaction } from "../ynab/categorize.js";
import { reconcile, type ScrapeRun } from "./reconcile.js";

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
