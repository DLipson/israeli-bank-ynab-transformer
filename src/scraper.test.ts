import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createScraper } from "israeli-bank-scrapers";
import { scrapeAccount } from "./scraper.js";
import type { AccountConfig } from "./config.js";

vi.mock("israeli-bank-scrapers", () => ({
  createScraper: vi.fn(),
}));

const mockedCreateScraper = vi.mocked(createScraper);

describe("scrapeAccount", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedCreateScraper.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries once after a timeout before returning the account result", async () => {
    const progress: string[] = [];
    const firstScraper = makeScraper({
      success: false,
      errorType: "TIMEOUT",
      errorMessage: "Page did not finish loading",
    });
    const secondScraper = makeScraper({
      success: true,
      accounts: [
        {
          accountNumber: "123456",
          txns: [
            {
              date: "2026-06-16T00:00:00+03:00",
              processedDate: "2026-06-16T00:00:00+03:00",
              originalAmount: 42,
              originalCurrency: "ILS",
              chargedAmount: -42,
              description: "Grocery",
              status: "completed",
              type: "normal",
            },
          ],
        },
      ],
    });

    mockedCreateScraper.mockReturnValueOnce(firstScraper).mockReturnValueOnce(secondScraper);

    const scrapePromise = scrapeAccount(makeAccount(), new Date("2026-06-01"), false, (message) => {
      progress.push(message);
    });

    await vi.advanceTimersByTimeAsync(3000);

    await expect(scrapePromise).resolves.toMatchObject({
      accountName: "Leumi",
      success: true,
      transactions: [{ accountNumber: "123456", accountName: "Leumi" }],
    });
    expect(mockedCreateScraper).toHaveBeenCalledTimes(2);
    expect(firstScraper.scrape).toHaveBeenCalledTimes(1);
    expect(secondScraper.scrape).toHaveBeenCalledTimes(1);
    expect(progress).toContain("  Timeout scraping Leumi. Retrying in 3 seconds...");
  });

  it("returns the timeout failure after the retry also times out", async () => {
    const firstScraper = makeScraper({
      success: false,
      errorType: "TIMEOUT",
      errorMessage: "Page did not finish loading",
    });
    const secondScraper = makeScraper({
      success: false,
      errorType: "TIMEOUT",
      errorMessage: "Still timed out",
    });

    mockedCreateScraper.mockReturnValueOnce(firstScraper).mockReturnValueOnce(secondScraper);

    const scrapePromise = scrapeAccount(makeAccount(), new Date("2026-06-01"), false);

    await vi.advanceTimersByTimeAsync(3000);

    await expect(scrapePromise).resolves.toMatchObject({
      accountName: "Leumi",
      success: false,
      transactions: [],
      error: "TIMEOUT: Still timed out",
    });
    expect(mockedCreateScraper).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-timeout scraper failures", async () => {
    const scraper = makeScraper({
      success: false,
      errorType: "INVALID_PASSWORD",
      errorMessage: "Bad password",
    });

    mockedCreateScraper.mockReturnValue(scraper);

    await expect(scrapeAccount(makeAccount(), new Date("2026-06-01"), false)).resolves.toMatchObject({
      accountName: "Leumi",
      success: false,
      transactions: [],
      error: "INVALID_PASSWORD: Bad password",
    });
    expect(mockedCreateScraper).toHaveBeenCalledTimes(1);
  });
});

function makeAccount(): AccountConfig {
  return {
    name: "Leumi",
    companyId: "leumi" as AccountConfig["companyId"],
    credentials: { userCode: "user", password: "password" },
    enabled: true,
  };
}

function makeScraper(result: unknown): ReturnType<typeof createScraper> {
  return {
    onProgress: vi.fn(),
    scrape: vi.fn().mockResolvedValue(result),
  } as unknown as ReturnType<typeof createScraper>;
}
describe("scrapeAllAccounts concurrency", () => {
  it("caps parallel scrapes and preserves result order", async () => {
    const { scrapeAllAccounts } = await import("./scraper.js");

    type AccountConfig = {
      name: string;
      companyId: any;
      credentials: Record<string, string>;
      enabled: boolean;
    };

    type ScrapeResult = {
      accountName: string;
      success: boolean;
      transactions: any[];
    };

    const accounts: AccountConfig[] = [
      { name: "A", companyId: 1 as any, credentials: {}, enabled: true },
      { name: "B", companyId: 2 as any, credentials: {}, enabled: true },
      { name: "C", companyId: 3 as any, credentials: {}, enabled: true },
    ];

    let active = 0;
    let maxActive = 0;

    const scrapeFn = async (account: AccountConfig): Promise<ScrapeResult> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(10);
      active -= 1;
      return {
        accountName: account.name,
        success: true,
        transactions: [],
      };
    };

    const results = await scrapeAllAccounts(accounts, new Date("2024-01-01"), false, undefined, undefined, {
      concurrency: 2,
      scrapeFn,
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results.map((r) => r.accountName)).toEqual(["A", "B", "C"]);
  });
});

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

