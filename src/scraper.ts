import { createScraper, type ScraperOptions } from "israeli-bank-scrapers";
import type { AccountConfig } from "./config.js";
import type { EnrichedTransaction } from "./transformer.js";

export interface ScrapeResult {
  accountName: string;
  success: boolean;
  transactions: EnrichedTransaction[];
  error?: string;
}

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

  try {
    const scraper = createScraper(options);

    // Set up progress logging
    scraper.onProgress((companyId, payload) => {
      onProgress?.(`  [${account.name}] ${payload.type}`);
    });

    const result = await scraper.scrape(account.credentials as any);

    if (!result.success) {
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
    onProgress?.(`  Exception: ${message}`);
    return {
      accountName: account.name,
      success: false,
      transactions: [],
      error: message,
    };
  }
}

/**
 * Scrape all enabled accounts
 */
export async function scrapeAllAccounts(
  accounts: AccountConfig[],
  startDate: Date,
  showBrowser: boolean,
  onProgress?: (message: string) => void
): Promise<ScrapeResult[]> {
  const enabledAccounts = accounts.filter((a) => a.enabled);

  if (enabledAccounts.length === 0) {
    onProgress?.("No accounts enabled for scraping.");
    return [];
  }

  onProgress?.(`\nScraping ${enabledAccounts.length} account(s)...`);
  onProgress?.(`Start date: ${startDate.toISOString().split("T")[0]}`);

  const results: ScrapeResult[] = [];

  // Scrape accounts sequentially to avoid overwhelming the browser
  for (const account of enabledAccounts) {
    const result = await scrapeAccount(account, startDate, showBrowser, onProgress);
    results.push(result);
  }

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
