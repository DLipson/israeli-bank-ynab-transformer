import { createHash } from "node:crypto";
import type { EnrichedTransaction, YnabRow } from "./transformer.js";
import type { ScrapeResult } from "./scraper.js";

export interface SkippedTransaction {
  reason: string;
  description: string;
  amount: number;
  date: string;
}

export interface AccountSummary {
  name: string;
  transactionCount: number;
  totalOutflow: number;
  totalInflow: number;
}

export interface AuditLog {
  timestamp: string;
  accounts: AccountSummary[];
  skipped: SkippedTransaction[];
  outputFile: string | null;
  outputTransactionCount: number;
  totalOutflow: number;
  totalInflow: number;
  checksum: string | null;
  // Detailed logging (optional)
  rawScraperResults?: any[];
  transformationDetails?: Array<{ raw: EnrichedTransaction; transformed: YnabRow }>;
  detailedLoggingLimit?: number;
}

export function createAuditLogger() {
  const log: AuditLog = {
    timestamp: new Date().toISOString(),
    accounts: [],
    skipped: [],
    outputFile: null,
    outputTransactionCount: 0,
    totalOutflow: 0,
    totalInflow: 0,
    checksum: null,
  };

  return {
    recordScrapeResults(results: ScrapeResult[]) {
      for (const result of results) {
        if (!result.success) continue;

        let outflow = 0;
        let inflow = 0;

        for (const txn of result.transactions) {
          const amount = txn.chargedAmount ?? 0;
          if (amount < 0) outflow += Math.abs(amount);
          if (amount > 0) inflow += amount;
        }

        log.accounts.push({
          name: result.accountName,
          transactionCount: result.transactions.length,
          totalOutflow: outflow,
          totalInflow: inflow,
        });
      }
    },

    recordRawScrapeResults(results: ScrapeResult[], limit: number = 0) {
      // Store the raw scraper results for detailed logging
      // If limit is 0, store all; otherwise store only the first 'limit' transactions from each account
      log.detailedLoggingLimit = limit;
      log.rawScraperResults = results.map((result) => ({
        accountName: result.accountName,
        success: result.success,
        error: result.error,
        transactions: limit > 0 ? result.transactions.slice(0, limit) : result.transactions,
      }));
    },

    recordSkipped(txn: EnrichedTransaction, reason: string) {
      log.skipped.push({
        reason,
        description: txn.description,
        amount: txn.chargedAmount ?? 0,
        date: txn.processedDate ?? txn.date ?? "unknown",
      });
    },

    recordTransformations(
      pairs: Array<{ raw: EnrichedTransaction; transformed: YnabRow }>,
      limit: number = 0
    ) {
      // Store transformation details for detailed logging
      log.transformationDetails = limit > 0 ? pairs.slice(0, limit) : pairs;
    },

    recordOutput(rows: YnabRow[], outputPath: string, csvContent: string) {
      log.outputFile = outputPath;
      log.outputTransactionCount = rows.length;

      for (const row of rows) {
        const outflow = parseFloat(row.outflow) || 0;
        const inflow = parseFloat(row.inflow) || 0;
        log.totalOutflow += outflow;
        log.totalInflow += inflow;
      }

      log.checksum = createHash("sha256").update(csvContent).digest("hex").slice(0, 16);
    },

    format(): string {
      return formatAuditLog(log);
    },

    getFilename(): string {
      return `run-${log.timestamp.replace(/:/g, "-").replace(/\.\d{3}Z$/, "")}.log`;
    },

    getLog(): AuditLog {
      return log;
    },
  };
}

export function formatAuditLog(log: AuditLog): string {
  const lines: string[] = [];

  lines.push(`=== Scrape Run: ${log.timestamp} ===`);
  lines.push("");

  lines.push("Accounts:");
  if (log.accounts.length === 0) {
    lines.push("  (none)");
  } else {
    for (const account of log.accounts) {
      const outflow = formatCurrency(account.totalOutflow);
      const inflow = formatCurrency(account.totalInflow);
      lines.push(
        `  ${account.name}: ${account.transactionCount} transactions (${outflow} out, ${inflow} in)`
      );
    }
  }
  lines.push("");

  lines.push(`Skipped (${log.skipped.length}):`);
  if (log.skipped.length === 0) {
    lines.push("  (none)");
  } else {
    for (const skipped of log.skipped) {
      const amount = formatCurrency(Math.abs(skipped.amount));
      const date = skipped.date.split("T")[0];
      lines.push(`  - ${skipped.reason}: "${skipped.description}" ${amount} (${date})`);
    }
  }
  lines.push("");

  if (log.outputFile) {
    lines.push(`Output: ${log.outputFile}`);
    lines.push(`  ${log.outputTransactionCount} transactions`);
    lines.push(
      `  Total: ${formatCurrency(log.totalOutflow)} outflow, ${formatCurrency(log.totalInflow)} inflow`
    );
    lines.push("");
    lines.push(`Checksum: ${log.checksum}`);
  } else {
    lines.push("Output: (none - dry run or no transactions)");
  }

  // Detailed logging sections
  if (log.rawScraperResults && log.rawScraperResults.length > 0) {
    lines.push("");
    lines.push("=== DETAILED LOGGING ===");
    lines.push("");
    lines.push("Raw Scraper Results:");
    if (log.detailedLoggingLimit && log.detailedLoggingLimit > 0) {
      lines.push(`  (Showing first ${log.detailedLoggingLimit} transaction(s) per account)`);
    } else {
      lines.push(`  (Showing all transactions)`);
    }
    lines.push("");

    for (const result of log.rawScraperResults) {
      lines.push(`Account: ${result.accountName}`);
      lines.push(`  Success: ${result.success}`);
      if (result.error) {
        lines.push(`  Error: ${result.error}`);
      }
      lines.push(`  Transactions (${result.transactions.length}):`);

      for (let i = 0; i < result.transactions.length; i++) {
        const txn = result.transactions[i];
        lines.push(`    [${i + 1}] ${JSON.stringify(txn, null, 2).split("\n").join("\n    ")}`);
      }
      lines.push("");
    }
  }

  if (log.transformationDetails && log.transformationDetails.length > 0) {
    lines.push("");
    lines.push("Transformation Details:");
    if (log.detailedLoggingLimit && log.detailedLoggingLimit > 0) {
      lines.push(`  (Showing first ${log.detailedLoggingLimit} transformation(s))`);
    } else {
      lines.push(`  (Showing all transformations)`);
    }
    lines.push("");

    for (let i = 0; i < log.transformationDetails.length; i++) {
      const { raw, transformed } = log.transformationDetails[i];
      lines.push(`[${i + 1}] RAW:`);
      lines.push(`    ${JSON.stringify(raw, null, 2).split("\n").join("\n    ")}`);
      lines.push(`    TRANSFORMED:`);
      lines.push(`    ${JSON.stringify(transformed, null, 2).split("\n").join("\n    ")}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function formatCurrency(amount: number): string {
  return `₪${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
