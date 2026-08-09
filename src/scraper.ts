import { createScraper, type ScraperOptions } from "israeli-bank-scrapers";
import type { AccountConfig } from "./config.js";
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
 * Scrape a single account
 */
export async function scrapeAccount(
  account: AccountConfig,
  startDate: Date,
  showBrowser: boolean,
  onProgress?: (message: string) => void
): Promise<ScrapeResult> {
  onProgress?.(`\nScraping ${account.name}...`);

  const options: ScraperOptions = {
    companyId: account.companyId,
    startDate,
    combineInstallments: false, // Keep installments separate for proper YNAB handling
    showBrowser,
    verbose: false,
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const scraper = createScraper(options);

      scraper.onProgress((companyId, payload) => {
        onProgress?.(`  [${account.name}] ${payload.type}`);
      });

      const credentials = account.credentials as Parameters<typeof scraper.scrape>[0];
      const result = await scraper.scrape(credentials);

      if (!result.success) {
        if (result.errorType === TIMEOUT_ERROR_TYPE && attempt === 1) {
          await waitBeforeTimeoutRetry(account.name, onProgress);
          continue;
        }

        onProgress?.(`  Error: ${result.errorType} - ${result.errorMessage}`);
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
        onProgress?.(`  Found ${bankAccount.txns.length} transactions in account ${bankAccount.accountNumber}`);

        for (const txn of bankAccount.txns) {
          transactions.push({
            ...txn,
            accountNumber: bankAccount.accountNumber,
            accountName: account.name,
          });
        }
      }

      onProgress?.(`  Total: ${transactions.length} transactions from ${account.name}`);

      return {
        accountName: account.name,
        success: true,
        transactions,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isTimeoutMessage(message) && attempt === 1) {
        await waitBeforeTimeoutRetry(account.name, onProgress);
        continue;
      }

      onProgress?.(`  Exception: ${message}`);
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

function isTimeoutMessage(message: string): boolean {
  return message.toLowerCase().includes("timeout");
}

async function waitBeforeTimeoutRetry(
  accountName: string,
  onProgress?: (message: string) => void
): Promise<void> {
  onProgress?.(`  Timeout scraping ${accountName}. Retrying in 3 seconds...`);
  await new Promise((resolve) => setTimeout(resolve, TIMEOUT_RETRY_DELAY_MS));
}

/**
 * Scrape all enabled accounts
 */
export async function scrapeAllAccounts(
  accounts: AccountConfig[],
  startDate: Date,
  showBrowser: boolean,
  onProgress?: (message: string) => void,
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
      const result = await scrapeFn(next.account, startDate, showBrowser, onProgress);
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
