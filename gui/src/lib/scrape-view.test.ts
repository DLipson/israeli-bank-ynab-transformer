import { describe, expect, it } from "vitest";
import type { RunSummary } from "@/api/client";
import { accountKind, accountStep, fromDate, lastUpdates } from "@/lib/scrape-view";

const run = (createdAt: string, accounts: Array<[string, boolean, string?]>): RunSummary => ({
  id: createdAt,
  createdAt,
  settings: { daysBack: 7, accounts: accounts.map(([a]) => a) },
  accounts: accounts.map(([accountName, success, error]) => ({ accountName, success, transactionCount: 3, error })),
  exports: [],
  ynabImports: [],
  rowCount: 3,
  totalOutflow: 0,
  totalInflow: 0,
});

describe("scrape view helpers", () => {
  const runs = [
    run("2026-10-15T10:00:00Z", [["Leumi", true], ["Max", false, "Login page did not load"]]),
    run("2026-10-12T10:00:00Z", [["Leumi", true], ["Max", true]]),
  ];

  it("finds each account's last success and a failure only when it is the newest try", () => {
    expect(lastUpdates(runs)).toEqual({
      Leumi: { lastSuccess: "2026-10-15T10:00:00Z" },
      Max: { lastSuccess: "2026-10-12T10:00:00Z", lastFailure: { at: "2026-10-15T10:00:00Z", error: "Login page did not load" } },
    });
  });

  it("starts from the oldest last success of the selected accounts, minus 3 days", () => {
    const updates = lastUpdates(runs);
    expect(fromDate(updates, ["Leumi"])).toBe("2026-10-12");
    expect(fromDate(updates, ["Leumi", "Max"])).toBe("2026-10-09");
    expect(fromDate(updates, ["Never"])).toBeNull();
  });

  it("reads the live step of an account from the progress messages", () => {
    const entries = [
      { text: "\nScraping Leumi...", account: "Leumi" },
      { text: "  [Leumi] LOGGING_IN", account: "Leumi" },
    ];
    expect(accountStep(entries, "Leumi")).toBe("Logging in");
    expect(accountStep([...entries, { text: "  [Leumi] LOGIN_SUCCESS", account: "Leumi" }], "Leumi")).toBe("Reading transactions");
    expect(accountStep([...entries, { text: "  Total: 14 transactions from Leumi", account: "Leumi" }], "Leumi")).toBe("Found 14");
    expect(accountStep(entries, "Max")).toBe("Waiting");
  });

  it("calls card companies cards and the rest banks", () => {
    expect(accountKind("visaCal")).toBe("Card");
    expect(accountKind("leumi")).toBe("Bank");
  });
});
