import { createScraper, type ScraperOptions } from "israeli-bank-scrapers";
import type { AccountConfig } from "./config.js";
import { startScraperTrace } from "./scraper-trace.js";
import type { EnrichedTransaction } from "./transformer.js";

export interface ScrapeResult {
  accountName: string;
  success: boolean;
  transactions: EnrichedTransaction[];
  error?: string;
}

const TIMEOUT_ERROR_TYPE = "TIMEOUT";
const TIMEOUT_RETRY_DELAY_MS = 3000;

/**
 * Scrape a single account. For banks with a trace (Leumi), the scraper's step-by-step debug lines
 * are saved to a trace file (see scraper-trace.ts).
 * `signal`: Cancel closes the scraper's browser at once (library `terminate`).
 */
export async function scrapeAccount(
  account: AccountConfig,
  startDate: Date,
  showBrowser: boolean,
  onProgress?: (message: string, accountName?: string) => void,
  signal?: AbortSignal
): Promise<ScrapeResult> {
  const stopTrace = startScraperTrace(account.companyId);
  try {
    return await scrapeAccountWithRetry(account, startDate, showBrowser, onProgress, signal);
  } finally {
    stopTrace();
  }
}

async function scrapeAccountWithRetry(
  account: AccountConfig,
  startDate: Date,
  showBrowser: boolean,
  onProgress?: (message: string, accountName?: string) => void,
  signal?: AbortSignal
): Promise<ScrapeResult> {
  onProgress?.(`\nScraping ${account.name}...`, account.name);

  const options: ScraperOptions = {
    companyId: account.companyId,
    startDate,
    combineInstallments: false, // Keep installments separate for proper YNAB handling
    showBrowser,
    verbose: false,
  };

  const canceled = (): ScrapeResult => {
    onProgress?.("  Canceled.", account.name);
    return { accountName: account.name, success: false, transactions: [], error: "Canceled" };
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const scraper = createScraper(options);
      // Not every scraper has `terminate` (only browser scrapers do).
      // `terminate` itself emits a progress event, so run `stop` only once or it calls itself without end.
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        void (scraper as { terminate?: (success: boolean) => Promise<void> }).terminate?.(false).catch(() => {});
      };

      scraper.onProgress((companyId, payload) => {
        onProgress?.(`  [${account.name}] ${payload.type}`, account.name);
        // The browser may start after the abort, so close it on each progress event.
        if (signal?.aborted) stop();
      });

      if (signal?.aborted) return canceled();

      const credentials = account.credentials as Parameters<typeof scraper.scrape>[0];
      signal?.addEventListener("abort", stop, { once: true });
      let result: Awaited<ReturnType<typeof scraper.scrape>>;
      try {
        result = await scraper.scrape(credentials);
      } finally {
        signal?.removeEventListener("abort", stop);
      }

      if (signal?.aborted) return canceled();

      if (!result.success) {
        if (attempt === 1 && (result.errorType === TIMEOUT_ERROR_TYPE || isTransientMessage(result.errorMessage))) {
          await waitBeforeRetry(account.name, onProgress);
          if (signal?.aborted) return canceled();
          continue;
        }

        onProgress?.(`  Error: ${result.errorType} - ${result.errorMessage}`, account.name);
        return {
          accountName: account.name,
          success: false,
          transactions: [],
          error: `${result.errorType}: ${result.errorMessage}`,
        };
      }

      // Collect and enrich transactions from all sub-accounts
      const transactions: EnrichedTransaction[] = [];

      for (const bankAccount of result.accounts ?? []) {
        onProgress?.(`  Found ${bankAccount.txns.length} transactions in account ${bankAccount.accountNumber}`, account.name);

        for (const txn of bankAccount.txns) {
          transactions.push({
            ...txn,
            accountNumber: bankAccount.accountNumber,
            accountName: account.name,
          });
        }
      }

      onProgress?.(`  Total: ${transactions.length} transactions from ${account.name}`, account.name);

      return {
        accountName: account.name,
        success: true,
        transactions,
      };
    } catch (error) {
      if (signal?.aborted) return canceled();
      const message = error instanceof Error ? error.message : String(error);
      if (isTransientMessage(message) && attempt === 1) {
        await waitBeforeRetry(account.name, onProgress);
        if (signal?.aborted) return canceled();
        continue;
      }

      onProgress?.(`  Exception: ${message}`, account.name);
      return {
        accountName: account.name,
        success: false,
        transactions: [],
        error: message,
      };
    }
  }

  throw new Error(`Unexpected scrape retry state for ${account.name}`);
}

/** Timeouts and Chrome network errors (net::ERR_...) are often temporary, so they get one retry. */
function isTransientMessage(message: string | undefined): boolean {
  const text = message ?? "";
  return text.toLowerCase().includes("timeout") || text.includes("net::ERR_");
}

async function waitBeforeRetry(
  accountName: string,
  onProgress?: (message: string, accountName?: string) => void
): Promise<void> {
  onProgress?.(`  Temporary error scraping ${accountName}. Retrying in 3 seconds...`, accountName);
  await new Promise((resolve) => setTimeout(resolve, TIMEOUT_RETRY_DELAY_MS));
}

/**
 * Scrape all enabled accounts
 */
export async function scrapeAllAccounts(
  accounts: AccountConfig[],
  startDate: Date,
  showBrowser: boolean,
  onProgress?: (message: string, accountName?: string) => void,
  abortSignal?: AbortSignal,
  options?: {
    concurrency?: number;
    scrapeFn?: typeof scrapeAccount;
  }
): Promise<ScrapeResult[]> {
  const enabledAccounts = accounts.filter((a) => a.enabled);
  const concurrency = Math.max(1, options?.concurrency ?? 1);
  const scrapeFn = options?.scrapeFn ?? scrapeAccount;

  if (enabledAccounts.length === 0) {
    onProgress?.("No accounts enabled for scraping.");
    return [];
  }

  if (abortSignal?.aborted) {
    onProgress?.("Scrape canceled before start.");
    return [];
  }

  onProgress?.(`\nScraping ${enabledAccounts.length} account(s)...`);
  onProgress?.(`Concurrency: ${concurrency}`);
  onProgress?.(`Start date: ${startDate.toISOString().split("T")[0]}`);

  const resultsByIndex: Array<ScrapeResult | undefined> = new Array(enabledAccounts.length);
  const queue = enabledAccounts.map((account, index) => ({ account, index }));

  const runNext = async (): Promise<void> => {
    if (abortSignal?.aborted) {
      onProgress?.("Scrape canceled.");
      return;
    }

    const next = queue.shift();
    if (!next) return;

    try {
      const result = await scrapeFn(next.account, startDate, showBrowser, onProgress, abortSignal);
      resultsByIndex[next.index] = result;
    } finally {
      if (queue.length > 0 && !abortSignal?.aborted) {
        await runNext();
      }
    }
  };

  const starters = [];
  const initial = Math.min(concurrency, queue.length);
  for (let i = 0; i < initial; i += 1) {
    starters.push(runNext());
  }

  await Promise.all(starters);

  if (abortSignal?.aborted) {
    return resultsByIndex.filter(Boolean) as ScrapeResult[];
  }

  const results = resultsByIndex.filter(Boolean) as ScrapeResult[];

  // Summary
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const totalTxns = results.reduce((sum, r) => sum + r.transactions.length, 0);

  onProgress?.(`\n--- Summary ---`);
  onProgress?.(`Successful: ${successful.length}/${results.length} accounts`);
  onProgress?.(`Total transactions: ${totalTxns}`);

  if (failed.length > 0) {
    onProgress?.(`\nFailed accounts:`);
    for (const f of failed) {
      onProgress?.(`  - ${f.accountName}: ${f.error}`);
    }
  }

  return results;
}
