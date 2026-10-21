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

  it("reads the live step of an account in the order the scraper sends its events", () => {
    const step = (...texts: string[]) => accountStep(texts.map((text) => ({ text, account: "Leumi" })), "Leumi");
    expect(accountStep([], "Leumi")).toBe("Waiting");
    expect(step("\nScraping Leumi...")).toBe("Starting");
    expect(step("\nScraping Leumi...", "  [Leumi] START_SCRAPING", "  [Leumi] INITIALIZING")).toBe("Opening the bank site");
    expect(step("  [Leumi] LOGGING_IN")).toBe("Logging in");
    expect(step("  [Leumi] LOGIN_SUCCESS")).toBe("Logged in · reading transactions");
    expect(step("  [Leumi] LOGIN_FAILED")).toBe("Login failed");
    expect(step("  [Leumi] CHANGE_PASSWORD")).toBe("The bank asks for a new password");
    expect(step("  [Leumi] TERMINATING")).toBe("Closing the bank site");
    expect(step("  Temporary error scraping Leumi. Retrying in 3 seconds...")).toBe("Temporary error · trying again");
    expect(step("  Found 9 transactions in account 123", "  Found 5 transactions in account 456")).toBe("Found 14 so far");
    expect(step("  Found 9 transactions in account 123", "  Total: 14 transactions from Leumi")).toBe("Found 14");
  });

  it("calls card companies cards and the rest banks", () => {
    expect(accountKind("visaCal")).toBe("Card");
    expect(accountKind("leumi")).toBe("Bank");
  });
});
