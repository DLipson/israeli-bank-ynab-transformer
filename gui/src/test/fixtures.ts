import type { SpendingData, SpendingSettings } from "@/api/client";

/** Small realistic settings (milliunits). */
export function settingsFixture(patch: Partial<SpendingSettings> = {}): SpendingSettings {
  return {
    mode: "cashflow",
    payday: "month-start",
    buffer: 500_000,
    flexibleCategoryIds: [],
    essentialCategoryIds: ["cat-food"],
    essentialsOverride: null,
    cardWarningLevel: 2_000_000,
    creditLimits: [],
    ignoredSuggestions: [],
    baselineMonths: 6,
    dismissedAnomalies: [],
    createdScheduleIds: [],
    refundLinks: [],
    incomeMarks: {},
    toCheck: [],
    ...patch,
  };
}

/** Spending numbers with the pieces that pages read, and empty lists for the rest. */
export function spendingFixture(patch: Partial<SpendingData> = {}): SpendingData {
  return {
    today: "2026-11-02",
    lastScrapedAt: null,
    spentVsIncome: {
      month: "2026-11",
      spent: 0,
      income: 0,
      difference: 0,
      daysLeft: 28,
      incomeParts: [],
      spendingItems: [],
      savedThisMonth: { amount: 0, items: [] },
      reasons: [],
      uncategorized: { amount: 0, count: 0 },
    },
    available: { periodEnd: "2026-11-30", total: 0, lines: [], warnings: [], essentialsNotChosen: false, essentialsOverridden: false },
    cards: [],
    watch: [],
    settings: settingsFixture(),
    obligations: [],
    suggestions: [],
    uncategorizedCount: 0,
    anomalies: [],
    missing: [],
    accounts: [
      { id: "acc-1", name: "Leumi Card", type: "creditCard", balance: -1_000_000 },
      { id: "acc-2", name: "Max Card", type: "creditCard", balance: -500_000 },
      { id: "acc-3", name: "Checking", type: "checking", balance: 3_000_000 },
    ],
    categories: [
      { id: "cat-food", name: "Groceries", group: "Everyday" },
      { id: "cat-fun", name: "Fun", group: "Extras" },
    ],
    ...patch,
  };
}
