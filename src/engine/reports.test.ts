import { describe, expect, it } from "vitest";
import { dueReports, monthlyReport, type MonthlyReportInput } from "./reports.js";

const K = 1000;

function input(o: Partial<MonthlyReportInput> = {}): MonthlyReportInput {
  return {
    today: "2026-11-01",
    lastScrapedAt: "2026-10-31T08:00:00Z",
    dataAsOf: "2026-10-31",
    months: [
      { month: "2026-05", income: 18000 * K, spent: 19000 * K },
      { month: "2026-06", income: 18000 * K, spent: 17000 * K },
      { month: "2026-07", income: 18000 * K, spent: 20000 * K },
      { month: "2026-08", income: 18000 * K, spent: 17500 * K },
      { month: "2026-09", income: 18100 * K, spent: 18000 * K },
      { month: "2026-10", income: 18100 * K, spent: 17000 * K },
    ],
    fixedLastMonth: 9200 * K,
    lastMonthCategories: [
      { name: "Groceries", group: "Everyday", assigned: 2000 * K, spent: 2900 * K, normal: 2600 * K },
      { name: "Gifts", group: "Fun", assigned: 500 * K, spent: 400 * K, normal: 300 * K },
    ],
    available: {
      periodEnd: "2026-11-30",
      total: 3000 * K,
      lines: [
        { key: "cash", label: "Cash", amount: 9000 * K },
        { key: "cards", label: "Card balance", amount: -6000 * K },
      ],
    },
    scheduledThisMonth: [{ date: "2026-11-06", label: "Rent", amount: 5500 * K }],
    gaps: [
      { name: "Groceries", assigned: 2000 * K, normal: 2600 * K },
      { name: "Fuel", assigned: 900 * K, normal: 950 * K },
    ],
    ...o,
  };
}

const text = (r: { sections: Array<{ title: string; rows: Array<{ label: string; value: string }> }> }) =>
  r.sections.map((s) => [s.title, ...s.rows.map((row) => `${row.label}: ${row.value}`)].join("\n")).join("\n");

describe("monthlyReport", () => {
  it("leads with last month's income vs spending, then the 6 months and the months within income", () => {
    const report = monthlyReport(input(), "2026-11-01T10:00:00Z");
    expect(report).toMatchObject({ type: "monthly", title: "Monthly report — November 2026" });
    const t = text(report);
    expect(report.sections[0].title).toBe("October 2026: income vs spending");
    expect(t).toContain("Income counted: ₪18,100");
    expect(t).toContain("Spent: ₪17,000");
    expect(t).toContain("Difference: ₪1,100 less than you earned");
    expect(report.sections[1].chart).toHaveLength(6);
    expect(t).toContain("3 months in a row within income"); // Aug, Sep, Oct; July was over
  });

  it("shows income − fixed payments, last month by category, and this month's calculation and gaps", () => {
    const t = text(monthlyReport(input(), "x"));
    expect(t).toContain("Fixed payments take ₪9,200 of your ₪18,100. ₪8,900 is left for everything else.");
    expect(t).toContain("Groceries: spent ₪2,900 · assigned ₪2,000 · normal ₪2,600");
    expect(t).toContain("Available until payday (30 Nov): ₪3,000");
    expect(t).toContain("6 Nov · Rent: ₪5,500");
    expect(t).toContain("Groceries: assigned ₪2,000, normal ₪2,600. Probably ₪600 short.");
    expect(t).not.toContain("Fuel: assigned"); // a gap under ₪200 is left out
  });

  it("counts 0 months within income when last month was over", () => {
    const months = input().months.map((m, i) => (i === 5 ? { ...m, spent: 20000 * K } : m));
    expect(text(monthlyReport(input({ months }), "x"))).toContain("0 months in a row within income");
  });
});

describe("dueReports", () => {
  it("makes the monthly report once per month, catching up after a missed day", () => {
    expect(dueReports("2026-11-01", { monthly: "2026-10" })).toEqual([{ type: "monthly" }]);
    expect(dueReports("2026-11-05", {})).toEqual([{ type: "monthly" }]);
    expect(dueReports("2026-11-05", { monthly: "2026-11" })).toEqual([]);
    // Old state keys from the weekly and month-end reports make nothing.
    expect(dueReports("2026-11-05", { monthly: "2026-11", weekly: "2026-10-18", "month-end": "2026-09" })).toEqual([]);
  });
});
