import { describe, expect, it } from "vitest";
import { buildMonthExport, lastFullMonth, monthsInRange, validateRange, type MonthExportInput } from "./month-export.js";

const today = "2026-11-15";

describe("validateRange", () => {
  it("accepts the current month", () => {
    expect(() => validateRange("2026-10", "2026-11", today)).not.toThrow();
  });
  it("rejects bad ranges", () => {
    expect(() => validateRange("2026-10", "2026-12", today)).toThrow(/future/i);
    expect(() => validateRange("2026-11", "2026-10", today)).toThrow(/later/);
    expect(() => validateRange("2026-13", "2026-11", today)).toThrow(/yyyy-mm/);
    expect(() => validateRange("2024-10", "2026-11", today)).toThrow(/24/);
  });
  it("has helpers", () => {
    expect(lastFullMonth(today)).toBe("2026-10");
    expect(monthsInRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("buildMonthExport", () => {
  const ref = { id: "t1", date: "2026-10-03", payee: "Shop", account: "Card", category: "Food", amount: -50000 };
  const month = (m: string, through: string): MonthExportInput => ({
    month: m,
    detail: {
      month: m,
      spent: 12500,
      income: 20000,
      difference: 7500,
      daysLeft: 0,
      incomeParts: [{ label: "Work", amount: 20000, items: [{ ...ref, id: "i1", amount: 20000, oneTime: false }] }],
      spendingItems: [ref],
      savedThisMonth: { amount: 0, items: [] },
      reasons: [],
      uncategorized: { amount: 0, count: 0 },
      through,
      memos: { t1: "note" },
    },
    fixedSpent: 5000,
    categories: [
      { id: "c0", name: "Empty", group: "G", type: "flexible", assigned: 0, spent: 0, normal: 0 },
      { id: "c1", name: "Food", group: "G", type: "flexible", assigned: 15000, spent: 12500, normal: 10000 },
    ],
  });

  it("converts to shekels and marks only the current month partial", () => {
    const out = buildMonthExport({
      madeAt: "x",
      today,
      dataAsOf: "2026-11-14",
      lastScrapedAt: null,
      settings: { payday: "month-start", baselineMonths: 6, flexibleCategoryIds: [], essentialCategoryIds: [] },
      months: [month("2026-10", "2026-10-31"), month("2026-11", today)],
    });
    expect(out.months.map((m) => m.partial)).toEqual([false, true]);
    expect(out.months[0].totals).toEqual({ income: 20, spent: 12.5, difference: 7.5 });
    expect(out.months[0].transactions[0]).toMatchObject({ amount: -50, memo: "note" });
    expect(out.months[0].totals.spent).toBeGreaterThan(0);
    expect(out.months[0].categories.map((c) => c.id)).toEqual(["c1"]);
    expect(out.months[0].categories[0]).toMatchObject({ assigned: 15, spent: 12.5, normal: 10 });
    expect(out.months[0].fixedSpent).toBe(5);
  });
});
