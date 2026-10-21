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

    const promise = scrapeAccount(makeAccount(), new Date("2026-06-01"), false, (message) => {
      progress.push(message);
    });

    await vi.advanceTimersByTimeAsync(3000);

    await expect(promise).resolves.toMatchObject({
      accountName: "Leumi",
      success: true,
      transactions: [{ accountNumber: "123456", accountName: "Leumi" }],
    });
    expect(mockedCreateScraper).toHaveBeenCalledTimes(2);
    expect(firstScraper.scrape).toHaveBeenCalledTimes(1);
    expect(secondScraper.scrape).toHaveBeenCalledTimes(1);
    expect(progress).toContain("  Temporary error scraping Leumi. Retrying in 3 seconds...");
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

    const promise = scrapeAccount(makeAccount(), new Date("2026-06-01"), false);

    await vi.advanceTimersByTimeAsync(3000);

    await expect(promise).resolves.toMatchObject({
      accountName: "Leumi",
      success: false,
      transactions: [],
      error: "TIMEOUT: Still timed out",
    });
    expect(mockedCreateScraper).toHaveBeenCalledTimes(2);
  });

  it("retries once after a navigation timeout reported as a generic error", async () => {
    const progress: string[] = [];
    const firstScraper = makeScraper({
      success: false,
      errorType: "GENERIC",
      errorMessage: "Navigation timeout of 30000 ms exceeded",
    });
    const secondScraper = makeScraper({
      success: true,
      accounts: [],
    });

    mockedCreateScraper.mockReturnValueOnce(firstScraper).mockReturnValueOnce(secondScraper);

    const promise = scrapeAccount(makeAccount(), new Date("2026-06-01"), false, (message) => {
      progress.push(message);
    });

    await vi.advanceTimersByTimeAsync(3000);

    await expect(promise).resolves.toMatchObject({ accountName: "Leumi", success: true });
    expect(mockedCreateScraper).toHaveBeenCalledTimes(2);
    expect(progress).toContain("  Temporary error scraping Leumi. Retrying in 3 seconds...");
  });

  it("retries once after a Chrome network error such as ERR_ABORTED", async () => {
    mockedCreateScraper
      .mockReturnValueOnce(
        makeScraper({ success: false, errorType: "GENERIC", errorMessage: "net::ERR_ABORTED at https://hb2.bankleumi.co.il/H/Login.html" })
      )
      .mockReturnValueOnce(makeScraper({ success: true, accounts: [] }));

    const promise = scrapeAccount(makeAccount(), new Date("2026-06-01"), false);
    await vi.advanceTimersByTimeAsync(3000);

    await expect(promise).resolves.toMatchObject({ accountName: "Leumi", success: true });
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

  it("closes the browser and returns Canceled when aborted during scrape", async () => {
    const controller = new AbortController();
    const { scraper, release } = makePendingScraper();
    mockedCreateScraper.mockReturnValue(scraper);

    const promise = scrapeAccount(makeAccount(), new Date("2026-06-01"), false, undefined, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(scraper.terminate).toHaveBeenCalledWith(false);
    release({ success: false, errorType: "GENERIC", errorMessage: "Target closed" });

    await expect(promise).resolves.toMatchObject({ success: false, error: "Canceled" });
  });

  it("closes the browser only once even when terminate reports progress", async () => {
    const controller = new AbortController();
    const { scraper, release } = makePendingScraper();
    mockedCreateScraper.mockReturnValue(scraper);
    const messages: string[] = [];

    const promise = scrapeAccount(makeAccount(), new Date("2026-06-01"), false, (m) => messages.push(m), controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(scraper.terminate).toHaveBeenCalledTimes(1);

    const callback = vi.mocked(scraper.onProgress).mock.calls[0][0];
    callback("leumi" as never, { type: "LOGGING_IN" } as never);
    expect(scraper.terminate).toHaveBeenCalledTimes(1);
    expect(messages.filter((m) => m.includes("TERMINATING"))).toHaveLength(1);

    release({ success: false, errorType: "GENERIC", errorMessage: "Target closed" });
    await promise;
  });

  it("does not start the scraper when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const scraper = makeScraper({ success: true, accounts: [] });
    mockedCreateScraper.mockReturnValue(scraper);

    await expect(
      scrapeAccount(makeAccount(), new Date("2026-06-01"), false, undefined, controller.signal)
    ).resolves.toMatchObject({ success: false, error: "Canceled" });
    expect(scraper.scrape).not.toHaveBeenCalled();
  });

  it("does not retry an aborted scrape that fails with a timeout", async () => {
    const controller = new AbortController();
    const { scraper, release } = makePendingScraper();
    mockedCreateScraper.mockReturnValue(scraper);

    const promise = scrapeAccount(makeAccount(), new Date("2026-06-01"), false, undefined, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    release({ success: false, errorType: "TIMEOUT", errorMessage: "timeout" });
    await vi.advanceTimersByTimeAsync(3000);

    await expect(promise).resolves.toMatchObject({ success: false, error: "Canceled" });
    expect(mockedCreateScraper).toHaveBeenCalledTimes(1);
  });
});

function makePendingScraper() {
  let release!: (result: unknown) => void;
  let cb: ((id: string, payload: { type: string }) => void) | undefined;
  // Like the real library: terminate emits a progress event at once.
  const scraper = {
    onProgress: vi.fn((fn) => void (cb = fn)),
    scrape: vi.fn().mockReturnValue(new Promise((resolve) => (release = resolve))),
    terminate: vi.fn(async () => {
      cb?.("id", { type: "TERMINATING" });
    }),
  } as unknown as ReturnType<typeof createScraper> & { terminate: ReturnType<typeof vi.fn> };
  return { scraper, release };
}

function makeAccount(): AccountConfig {
  return {
    name: "Leumi",
    bankName: "Leumi",
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
      bankName: string;
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
      { name: "A", bankName: "A", companyId: 1 as any, credentials: {}, enabled: true },
      { name: "B", bankName: "B", companyId: 2 as any, credentials: {}, enabled: true },
      { name: "C", bankName: "C", companyId: 3 as any, credentials: {}, enabled: true },
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

  it("passes the abort signal to scrapeFn", async () => {
    const { scrapeAllAccounts } = await import("./scraper.js");
    const controller = new AbortController();
    const scrapeFn = vi.fn().mockResolvedValue({ accountName: "A", success: true, transactions: [] });
    const accounts = [{ name: "A", bankName: "A", companyId: 1 as any, credentials: {}, enabled: true }];

    await scrapeAllAccounts(accounts, new Date("2024-01-01"), false, undefined, controller.signal, { scrapeFn });

    expect(scrapeFn.mock.calls[0][4]).toBe(controller.signal);
  });
});

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

