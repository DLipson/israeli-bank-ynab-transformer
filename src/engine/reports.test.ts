import { describe, expect, it } from "vitest";
import { dueReports, monthEndReport, monthEndTarget, monthStartReport, weeklyReport, type ReportInput } from "./reports.js";

const K = 1000;
const pace = (name: string, status: "under" | "on" | "over" | "fixed-paid" | "fixed-due", thisMonth = 0, normalByToday = 0) => ({
  name,
  normalMonth: 1000 * K,
  normalByToday: normalByToday * K,
  thisMonth: thisMonth * K,
  difference: normalByToday ? thisMonth / normalByToday - 1 : null,
  status,
});

function input(o: Partial<ReportInput> = {}): ReportInput {
  return {
    today: "2026-10-18",
    lastScrapedAt: "2026-10-17T00:00:00Z",
    periodEnd: "2026-10-31",
    mode: "cashflow",
    cashflow: { total: 21815 * K, lines: [{ label: "Expected normal spending until 2026-10-31", amount: -9498 * K }], warnings: [] },
    ynab: { total: 1717 * K, lines: [], warnings: [] },
    baseline: {
      months: 6,
      asOf: "2026-10-17",
      total: pace("Total", "on", 15000, 14000),
      categories: [],
      uncategorized: 300 * K,
      topOver: [pace("Tzeduka", "over", 735, 375)],
    },
    exposure: [{ name: "Overdraft", limit: 40000 * K, used: 20260 * K, unused: 19740 * K, lines: [] }, { name: "Cal", limit: null, used: 800 * K, unused: null, lines: [] }],
    obligations: [{ month: "2026-11", installments: 0, scheduled: 5595 * K, total: 5595 * K }],
    upcoming: [
      { date: "2026-10-20", label: "Ichud Hatzala", amount: 30 * K },
      { date: "2026-10-30", label: "Partner", amount: 95 * K },
    ],
    suggestionsCount: 12,
    anomalies: [{ id: "x", kind: "duplicate", date: "2026-10-15", title: "Possible duplicate: Shop", detail: "₪90 twice", amount: 90000, transactionIds: [] }],
    uncategorizedCount: 4,
    previousMonth: { month: "2026-09", spent: 31000 * K, normal: 26951 * K },
    ...o,
  };
}

const text = (r: { sections: Array<{ title: string; rows: Array<{ label: string; value: string }> }> }) =>
  r.sections.map((s) => [s.title, ...s.rows.map((row) => `${row.label}: ${row.value}`)].join("\n")).join("\n");

describe("weeklyReport", () => {
  it("saves the explanation and calculation lines with the report", () => {
    const section = weeklyReport(input(), "x").sections[0];
    expect(section.explanation).toContain("18 Oct through 31 Oct");
    expect(section.details).toHaveLength(1);
    expect(section.details?.[0].label).toBe("Expected normal spending until 2026-10-31");
  });

  it("has left to spend, pace with the top category, the next 7 days, credit, and what needs attention", () => {
    const t = text(weeklyReport(input(), "2026-10-18T10:00:00Z"));
    expect(t).toContain("Cash-flow (main): ₪21,815");
    expect(t).toContain("Normal spending still expected: ₪9,498");
    expect(t).toContain("Tzeduka: ₪735 vs. normal ₪375 — over pace (+96%)");
    expect(t).toContain("Not categorized yet: ₪300");
    expect(t).toContain("20 Oct · Ichud Hatzala: ₪30");
    expect(t).not.toContain("Partner"); // 30 Oct is more than 7 days away
    expect(t).toContain("Overdraft: ₪19,740 unused of ₪40,000");
    expect(t).toContain("Cal: ₪800 used, limit not set");
    expect(t).toContain("Repeating payments without a schedule: 12");
    expect(t).not.toContain("last import"); // 1 day old is fresh
    expect(t).toContain("Possible duplicate: Shop: ₪90 twice");
  });

  it("warns when the bank data is 3 or more days old", () => {
    const t = text(weeklyReport(input({ lastScrapedAt: "2026-10-05T00:00:00Z" }), "x"));
    expect(t).toContain("last successful scrape 5 Oct (13 days ago): run a scrape");
  });

  it("warns when no successful scrape is recorded", () => {
    const t = text(weeklyReport(input({ lastScrapedAt: null }), "x"));
    expect(t).toContain("no successful scrape recorded: run a scrape");
  });
});

describe("monthStartReport", () => {
  it("summarizes last month and lists this month's scheduled payments", () => {
    const t = text(monthStartReport(input({ today: "2026-10-01" }), "x"));
    expect(t).toContain("Spent: ₪31,000 vs. normal ₪26,951 (+15%)");
    expect(t).toContain("Total: ₪125");
    expect(t).toContain("November 2026: ₪5,595");
  });
});

describe("monthEndReport", () => {
  it("compares spent with assigned and lists the biggest differences first", () => {
    const r = monthEndReport(
      "2026-09",
      [
        { name: "Groceries", group: "Food", assigned: 4000 * K, spent: 6000 * K, normal: 5500 * K },
        { name: "Gas", group: "Car", assigned: 600 * K, spent: 500 * K, normal: 640 * K },
        { name: "Unused", group: "X", assigned: 0, spent: 0, normal: 0 },
      ],
      { spent: 9000 * K, normal: 8000 * K, uncategorized: 2500 * K },
      "2026-09-30",
      "x"
    );
    const t = text(r);
    expect(t).toContain("Spent: ₪9,000");
    expect(t).toContain("of which not categorized: ₪2,500");
    expect(t).toContain("Spent vs. assigned: ₪4,400");
    expect(r.sections[1].rows.map((row) => row.label)).toEqual(["Groceries", "Gas"]);
  });
});

describe("dueReports", () => {
  it("uses this month at month end, otherwise the previous full month", () => {
    expect(monthEndTarget("2026-10-31")).toBe("2026-10");
    expect(monthEndTarget("2026-10-30")).toBe("2026-09");
  });

  it("makes the weekly report on Sunday, and catches up once after a missed Sunday", () => {
    // 2026-10-18 is a Sunday.
    expect(dueReports("2026-10-18", { weekly: "2026-10-11", "month-start": "2026-10", "month-end": "2026-09" })).toEqual([{ type: "weekly" }]);
    expect(dueReports("2026-10-20", { weekly: "2026-10-18", "month-start": "2026-10", "month-end": "2026-09" })).toEqual([]);
    expect(dueReports("2026-10-21", { weekly: "2026-10-11", "month-start": "2026-10", "month-end": "2026-09" })).toEqual([{ type: "weekly" }]);
  });

  it("makes the start-of-month report once per month, and the end-of-month report on the last day", () => {
    expect(dueReports("2026-11-01", { weekly: "2026-11-01", "month-start": "2026-10", "month-end": "2026-10" })).toEqual([{ type: "month-start" }]);
    expect(dueReports("2026-10-31", { weekly: "2026-10-25", "month-start": "2026-10", "month-end": "2026-09" })).toEqual([{ type: "month-end", month: "2026-10" }]);
    // Missed the last day (PC off): the 1st catches up the previous month.
    expect(dueReports("2026-11-01", { weekly: "2026-11-01", "month-start": "2026-11", "month-end": "2026-09" })).toEqual([{ type: "month-end", month: "2026-10" }]);
  });

  it("makes everything on the first run", () => {
    expect(dueReports("2026-10-12", {}).map((d) => d.type)).toEqual(["weekly", "month-start", "month-end"]);
  });
});
