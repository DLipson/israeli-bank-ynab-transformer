import { describe, expect, it } from "vitest";
import { buildCategoryAvailabilityReport, type YnabCategoryGroup } from "./report-service.js";

function createGroups(): YnabCategoryGroup[] {
  return [
    {
      id: "group-1",
      name: "Monthly",
      hidden: false,
      deleted: false,
      categories: [
        {
          id: "cat-green",
          name: "Groceries",
          hidden: false,
          deleted: false,
          balance: 550_000,
        },
        {
          id: "cat-yellow",
          name: "Fuel",
          hidden: false,
          deleted: false,
          balance: 120_000,
        },
        {
          id: "cat-red",
          name: "Dining",
          hidden: false,
          deleted: false,
          balance: -5_000,
        },
      ],
    },
  ];
}

describe("buildCategoryAvailabilityReport", () => {
  it("classifies status by threshold and sorts red/yellow/green", () => {
    const report = buildCategoryAvailabilityReport({
      budgetId: "budget-1",
      timezone: "Asia/Jerusalem",
      currency: "ILS",
      yellowThresholdMilliunits: 200_000,
      selectedCategories: [
        { id: "cat-green", label: "Groceries" },
        { id: "cat-yellow", label: "Fuel" },
        { id: "cat-red", label: "Dining" },
      ],
      categoryGroups: createGroups(),
      now: new Date("2026-02-17T05:00:00.000Z"),
    });

    expect(report.rows.map((row) => row.id)).toEqual(["cat-red", "cat-yellow", "cat-green"]);
    expect(report.rows.map((row) => row.status)).toEqual(["red", "yellow", "green"]);
    expect(report.totals).toEqual({ red: 1, yellow: 1, green: 1, count: 3 });
  });

  it("uses currency formatting from milliunits", () => {
    const report = buildCategoryAvailabilityReport({
      budgetId: "budget-1",
      timezone: "Asia/Jerusalem",
      currency: "ILS",
      locale: "en-IL",
      yellowThresholdMilliunits: 200_000,
      selectedCategories: [{ id: "cat-yellow", label: "Fuel" }],
      categoryGroups: createGroups(),
      now: new Date("2026-02-17T05:00:00.000Z"),
    });

    expect(report.rows[0]?.available).toContain("120.00");
  });

  it("throws when selected category ids are missing", () => {
    expect(() =>
      buildCategoryAvailabilityReport({
        budgetId: "budget-1",
        timezone: "Asia/Jerusalem",
        currency: "ILS",
        yellowThresholdMilliunits: 200_000,
        selectedCategories: [{ id: "does-not-exist", label: "Unknown" }],
        categoryGroups: createGroups(),
      })
    ).toThrow("Missing selected categories");
  });
});
