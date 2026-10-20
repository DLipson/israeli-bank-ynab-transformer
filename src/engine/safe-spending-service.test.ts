import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ynabRequest = vi.fn();
vi.mock("../ynab/import-service.js", () => ({ ynabRequest, loadYnabImportConfig: () => ({ budgetId: "b", mappings: [] }) }));
vi.mock("../ynab/transaction-cache.js", () => ({ getAllTransactions: async () => [] }));

const { getSpending, lastSuccessfulScrapeAt, loadSettings } = await import("./safe-spending-service.js");

describe("lastSuccessfulScrapeAt", () => {
  it("uses the newest fully successful scrape", () => {
    const runs = [
      {
        createdAt: "2026-10-15T09:00:00.000Z",
        accounts: [
          { accountName: "Checking", success: true, transactionCount: 3 },
          { accountName: "Card", success: false, transactionCount: 0 },
        ],
      },
      {
        createdAt: "2026-10-14T09:00:00.000Z",
        accounts: [{ accountName: "Checking", success: true, transactionCount: 2 }],
      },
    ];
    expect(lastSuccessfulScrapeAt(runs)).toBe("2026-10-14T09:00:00.000Z");
  });

  it("returns null when no successful run is recorded", () => {
    expect(lastSuccessfulScrapeAt([])).toBeNull();
    expect(lastSuccessfulScrapeAt([{ createdAt: "2026-10-15T09:00:00.000Z", accounts: [] }])).toBeNull();
  });
});

describe("loadSettings", () => {
  let previousConfigDir: string | undefined;
  let dir: string;

  beforeEach(() => {
    previousConfigDir = process.env.ISRAELI_BANK_YNAB_CONFIG_DIR;
    dir = mkdtempSync(join(tmpdir(), "safe-spending-settings-"));
    process.env.ISRAELI_BANK_YNAB_CONFIG_DIR = dir;
  });

  afterEach(() => {
    if (previousConfigDir === undefined) delete process.env.ISRAELI_BANK_YNAB_CONFIG_DIR;
    else process.env.ISRAELI_BANK_YNAB_CONFIG_DIR = previousConfigDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it("migrates an old settings file and saves only current keys", () => {
    const path = join(dir, "safe-spending.json");
    writeFileSync(
      path,
      JSON.stringify({
        mode: "cashflow",
        periodEnd: "month-end",
        buffer: 45000,
        flexibleCategoryIds: ["groceries"],
        overdraft: { limitAccountId: "limit", accountId: "checking" },
        subtractExpected: true,
      })
    );

    const settings = loadSettings();
    expect(settings).toMatchObject({
      payday: "month-start",
      buffer: 45000,
      flexibleCategoryIds: ["groceries"],
    });
    const saved = JSON.parse(readFileSync(path, "utf-8"));
    expect(saved).toMatchObject({ payday: "month-start", buffer: 45000 });
    expect(saved).not.toHaveProperty("periodEnd");
    expect(saved).not.toHaveProperty("overdraft");
    expect(saved).not.toHaveProperty("subtractExpected");
    expect(loadSettings()).toEqual(settings);
  });
});
describe("getSpending quick reload", () => {
  let previousConfigDir: string | undefined;
  let dir: string;

  beforeEach(() => {
    previousConfigDir = process.env.ISRAELI_BANK_YNAB_CONFIG_DIR;
    dir = mkdtempSync(join(tmpdir(), "safe-spending-quick-"));
    process.env.ISRAELI_BANK_YNAB_CONFIG_DIR = dir;
    ynabRequest.mockReset();
    ynabRequest.mockImplementation(async (_token: string, path: string) => {
      if (path.endsWith("/accounts")) return { accounts: [] };
      if (path.endsWith("/months/current")) return { month: { month: "2026-10-01", to_be_budgeted: 0, categories: [] } };
      if (path.endsWith("/scheduled_transactions")) return { scheduled_transactions: [] };
      throw new Error(`unexpected ${path}`);
    });
  });

  afterEach(() => {
    if (previousConfigDir === undefined) delete process.env.ISRAELI_BANK_YNAB_CONFIG_DIR;
    else process.env.ISRAELI_BANK_YNAB_CONFIG_DIR = previousConfigDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it("reuses the last YNAB data after a settings change, and reads YNAB again otherwise", async () => {
    await getSpending("token", "2026-10-20");
    expect(ynabRequest).toHaveBeenCalledTimes(3);
    const quick = await getSpending("token", "2026-10-20", { quick: true });
    expect(ynabRequest).toHaveBeenCalledTimes(3);
    expect(quick.available.periodEnd).toBe("2026-10-31");
    await getSpending("token", "2026-10-20");
    expect(ynabRequest).toHaveBeenCalledTimes(6);
  });
});
