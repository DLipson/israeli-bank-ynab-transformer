import { describe, expect, it } from "vitest";
import type { YnabTransaction } from "../ynab/categorize.js";
import type { Pace } from "./baseline.js";
import { detectAnomalies } from "./anomalies.js";

const K = 1000;
let n = 0;

function txn(date: string, shekels: number, o: Partial<YnabTransaction> = {}): YnabTransaction {
  n += 1;
  return {
    id: `t${String(n).padStart(3, "0")}`,
    date,
    amount: -shekels * K,
    memo: null,
    payee_name: "Shop",
    category_id: "c",
    category_name: "Cat",
    account_id: "card",
    account_name: "Card",
    transfer_account_id: null,
    deleted: false,
    ...o,
  };
}

const kinds = (list: { kind: string }[]) => list.map((a) => a.kind).sort();
const AS_OF = "2026-10-12";

describe("detectAnomalies", () => {
  it("finds a charge far above the payee's usual amount, once per day", () => {
    const history = ["2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05"].map((d) => txn(d, 100, { payee_name: "Gym" }));
    const found = detectAnomalies([...history, txn("2026-10-05", 400, { payee_name: "Gym" })], [], AS_OF);
    expect(kinds(found)).toEqual(["unusual-charge"]);
    expect(found[0].detail).toBe("₪400; usually ₪100 (4 earlier payments).");
  });

  it("does not repeat an unusual charge once the payee stays at the new level", () => {
    const history = ["2026-06-05", "2026-07-05", "2026-08-05"].map((d) => txn(d, 70, { payee_name: "Charity" }));
    const found = detectAnomalies(
      [...history, txn("2026-09-22", 250, { payee_name: "Charity" }), txn("2026-10-05", 250, { payee_name: "Charity" })],
      [],
      AS_OF
    );
    expect(found.filter((a) => a.kind === "unusual-charge").map((a) => a.date)).toEqual(["2026-09-22"]);
  });

  it("finds a new payee of ₪100 or more, with the real recipient of a bank transfer", () => {
    const found = detectAnomalies(
      [
        txn("2026-10-06", 350, { payee_name: "New class" }),
        txn("2026-10-07", 40, { payee_name: "Small new shop" }),
        txn("2026-09-22", 1000, {
          payee_name: "הע. אינטרנט",
          account_id: "main",
          memo: JSON.stringify({ bankMemo: "העברה אל: SARA BAILA 12-446-000074950 תשלום" }),
        }),
      ],
      [],
      AS_OF
    );
    expect(found.map((a) => a.title)).toEqual(["New payee: New class", "New payee: SARA BAILA"]);
  });

  it("finds possible duplicates of ₪50 or more, and skips cash, transfers, and installments", () => {
    const base = [txn("2026-08-01", 250, { payee_name: "Charity" }), txn("2026-09-01", 250, { payee_name: "Charity" })];
    const found = detectAnomalies(
      [
        ...base,
        txn("2026-10-02", 250, { payee_name: "Charity" }),
        txn("2026-10-03", 250, { payee_name: "Charity" }),
        txn("2026-10-02", 18, { payee_name: "Card fee" }),
        txn("2026-10-02", 18, { payee_name: "Card fee" }),
        txn("2026-10-02", 500, { payee_name: "משיכת מזומן" }),
        txn("2026-10-02", 500, { payee_name: "משיכת מזומן" }),
        txn("2026-10-02", 135, { payee_name: "Course", memo: JSON.stringify({ installment: "2/10" }) }),
        txn("2026-10-02", 135, { payee_name: "Course", memo: JSON.stringify({ installment: "3/10" }) }),
      ],
      [],
      AS_OF
    );
    const duplicates = found.filter((a) => a.kind === "duplicate");
    expect(duplicates.map((a) => a.title)).toEqual(["Possible duplicate: Charity"]);
  });

  it("finds a monthly payment whose price went up", () => {
    const months = ["2026-06-28", "2026-07-28", "2026-08-28"].map((d) => txn(d, 54, { payee_name: "Phone" }));
    const found = detectAnomalies([...months, txn("2026-09-28", 64, { payee_name: "Phone" })], [], AS_OF);
    expect(found.find((a) => a.kind === "price-increase")?.detail).toBe("₪64 this time; it was ₪54 a month before.");
  });

  it("does not call charges in nonconsecutive months a monthly price increase", () => {
    const charges = ["2026-06-28", "2026-08-28", "2026-09-28"].map((d) => txn(d, 54, { payee_name: "Phone" }));
    const found = detectAnomalies([...charges, txn("2026-10-10", 64, { payee_name: "Phone" })], [], AS_OF);
    expect(found.some((a) => a.kind === "price-increase")).toBe(false);
  });

  it("does not report a price increase when the latest prior month has no charge", () => {
    const charges = ["2026-06-28", "2026-07-28", "2026-08-28"].map((d) => txn(d, 54, { payee_name: "Phone" }));
    const found = detectAnomalies([...charges, txn("2026-10-10", 64, { payee_name: "Phone" })], [], AS_OF);
    expect(found.some((a) => a.kind === "price-increase")).toBe(false);
  });

  it("finds a category already well over a whole normal month, but not a fixed one", () => {
    const pace = (name: string, normalMonth: number, thisMonth: number, status: Pace["status"] = "over"): Pace => ({
      name,
      normalMonth: normalMonth * K,
      normalByToday: 0,
      thisMonth: thisMonth * K,
      difference: null,
      status,
    });
    const found = detectAnomalies([], [pace("Clothing", 400, 1000), pace("Gas", 600, 700), pace("Rent", 5500, 11000, "fixed-paid")], AS_OF);
    expect(found.map((a) => a.title)).toEqual(["Clothing is over a whole normal month"]);
  });

  it("flags one installment payment imported twice after the bank changed its charge date", () => {
    const memo = (chargeDate: string) => JSON.stringify({ installment: "6/11", originalAmount: -1558, chargeDate });
    const found = detectAnomalies(
      [txn("2026-10-03", 141.63, { payee_name: "Insurance", memo: memo("2026-11-02") }), txn("2026-10-11", 141.63, { payee_name: "Insurance", memo: memo("2026-11-10") })],
      [],
      AS_OF
    );
    expect(found).toEqual([
      expect.objectContaining({
        kind: "installment-twice",
        detail: "Payment 6 of 11 (₪142) is on Card 2 times (2026-10-03, 2026-10-11). The bank charges it once.",
      }),
    ]);
  });

  it("flags a full purchase that is also in YNAB as credit-deal installments", () => {
    const full = txn("2026-08-12", 1436.1, { payee_name: "City" });
    const payment = txn("2026-10-03", 294.62, { payee_name: "City", memo: JSON.stringify({ installment: "1/5", originalAmount: -1436.1 }) });
    const found = detectAnomalies([full, payment], [], AS_OF);
    expect(found).toEqual([expect.objectContaining({ kind: "full-and-installments", id: `full-and-installments:${full.id}`, transactionIds: [full.id, payment.id] })]);
    expect(detectAnomalies([payment], [], AS_OF)).toEqual([]);
  });

  it("leaves out dismissed findings and transactions older than 30 days", () => {
    const old = txn("2026-08-01", 900, { payee_name: "Old new shop" });
    const fresh = txn("2026-10-01", 900, { payee_name: "Fresh new shop" });
    expect(detectAnomalies([old, fresh], [], AS_OF).map((a) => a.id)).toEqual([`new-payee:${fresh.id}`]);
    expect(detectAnomalies([old, fresh], [], AS_OF, [`new-payee:${fresh.id}`])).toEqual([]);
  });
});
