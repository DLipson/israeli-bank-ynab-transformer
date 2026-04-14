#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { program } from "commander";
import { loadConfig } from "./config.js";
import { scrapeAllAccounts } from "./scraper.js";
import { transformTransactions, filterAndPartition, groupByAccount, calculateSummary, type EnrichedTransaction } from "./transformer.js";
import { toCSV, generateFilename } from "./csv-writer.js";
import { createAuditLogger } from "./audit-logger.js";
import { reconcile, formatReconcileReport } from "./reconcile.js";
import { getEnvFilePath, loadAppEnv } from "./env.js";

loadAppEnv();

program
  .name("israeli-bank-ynab")
  .description("Scrape Israeli bank accounts and export to YNAB-ready CSV")
  .version("1.0.0");

program
  .command("scrape")
  .description("Scrape all configured accounts and generate YNAB CSV")
  .option("-d, --days-back <days>", "Number of days to scrape", "60")
  .option("-s, --show-browser", "Show browser window during scraping", false)
  .option("-o, --output <dir>", "Output directory", "./output")
  .option("--split", "Generate separate CSV per account", false)
  .option("--dry-run", "Preview what would be exported without writing files", false)
  .action(async (options) => {
    const config = loadConfig({
      showBrowser: options.showBrowser,
      daysBack: parseInt(options.daysBack, 10),
    });

    for (const warning of config.warnings) {
      console.warn(warning);
    }

    if (options.output) {
      config.outputDir = options.output;
    }

    const auditLogger = createAuditLogger();
    const results = await scrapeAllAccounts(
      config.accounts,
      config.startDate,
      config.showBrowser,
      console.log
    );

    auditLogger.recordScrapeResults(results);

    const allRawTransactions: EnrichedTransaction[] = [];
    for (const result of results) {
      if (result.success) {
        allRawTransactions.push(...result.transactions);
      }
    }

    const { kept: allTransactions, skipped } = filterAndPartition(allRawTransactions);
    for (const { txn, reason } of skipped) {
      auditLogger.recordSkipped(txn, reason);
    }

    if (allTransactions.length === 0) {
      console.log("\nNo transactions to export.");
      saveAuditLog(auditLogger);
      return;
    }

    console.log(`\nTransforming ${allTransactions.length} transactions to YNAB format...`);

    if (options.dryRun) {
      printDryRunSummary(allTransactions);
      console.log("\n[Dry run - no files written]");
      saveAuditLog(auditLogger);
      return;
    }

    if (options.split) {
      const byAccount = groupByAccount(allTransactions);
      const rowsByAccount = new Map<string, ReturnType<typeof transformTransactions>>();

      for (const [account, txns] of byAccount) {
        rowsByAccount.set(account, transformTransactions(txns));
      }

      const paths = writeCSVPerAccount(rowsByAccount, config.outputDir);
      console.log(`\nWrote ${paths.length} CSV file(s):`);
      for (const path of paths) {
        console.log(`  ${path}`);
      }

      const allRows = Array.from(rowsByAccount.values()).flat();
      auditLogger.recordOutput(allRows, paths.join(", "), "");
    } else {
      const rows = transformTransactions(allTransactions);
      const csvContent = toCSV(rows);
      const outputPath = writeCSV(rows, config.outputDir);

      console.log(`\nWrote ${rows.length} transactions to:`);
      console.log(`  ${outputPath}`);

      auditLogger.recordOutput(rows, outputPath, csvContent);
    }

    const logPath = saveAuditLog(auditLogger);
    console.log(`\nAudit log saved to: ${logPath}`);
    console.log("\nDone!");
  });

program
  .command("reconcile")
  .description("Compare bank CSV against scraper output to verify nothing was missed or duplicated")
  .argument("<source>", "Source CSV file (e.g., bank export)")
  .argument("<target>", "Target CSV file (e.g., scraper output)")
  .action((source, target) => {
    console.log(`\nReconciling: ${source} vs ${target}\n`);

    try {
      const sourceContent = readFileSync(source, "utf-8");
      const targetContent = readFileSync(target, "utf-8");
      const result = reconcile(sourceContent, targetContent, source, target);
      const report = formatReconcileReport(result);
      console.log(report);

      const hasDiscrepancies = result.missingFromTarget.length > 0 || result.extraInTarget.length > 0;
      process.exitCode = hasDiscrepancies ? 1 : 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("list-accounts")
  .description("List configured accounts and their status")
  .action(() => {
    const config = loadConfig();

    for (const warning of config.warnings) {
      console.warn(warning);
    }

    console.log("\nConfigured accounts:\n");
    for (const account of config.accounts) {
      const status = account.enabled ? "enabled" : "disabled (missing credentials)";
      console.log(`  ${account.name}: ${status}`);
    }
    console.log("\nTo enable accounts, add credentials in the GUI Accounts tab.");
    console.log(`Or set credentials manually in: ${getEnvFilePath()}`);
  });

program.action(() => {
  program.help();
});

program.parse();

function writeCSV(
  rows: ReturnType<typeof transformTransactions>,
  outputDir: string,
  filename?: string
): string {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const outputFilename = filename ?? generateFilename();
  const outputPath = join(outputDir, outputFilename);
  const csv = toCSV(rows);
  writeFileSync(outputPath, csv, "utf-8");
  return outputPath;
}

function writeCSVPerAccount(
  rowsByAccount: Map<string, ReturnType<typeof transformTransactions>>,
  outputDir: string
): string[] {
  const paths: string[] = [];

  for (const [accountName, rows] of rowsByAccount) {
    if (rows.length === 0) continue;

    const safeName = accountName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
    const filename = generateFilename(`ynab-${safeName}`);
    const path = writeCSV(rows, outputDir, filename);
    paths.push(path);
  }

  return paths;
}

const LOG_DIR = "./logs";
const LOG_RETENTION_DAYS = 14;

function saveAuditLog(auditLogger: ReturnType<typeof createAuditLogger>): string {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }

  cleanOldLogs(LOG_DIR, LOG_RETENTION_DAYS);

  const filepath = join(LOG_DIR, auditLogger.getFilename());
  writeFileSync(filepath, auditLogger.format(), "utf-8");
  return filepath;
}

function cleanOldLogs(logDir: string, retentionDays: number) {
  if (!existsSync(logDir)) return;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  try {
    const files = readdirSync(logDir);
    for (const file of files) {
      if (!file.startsWith("run-") || !file.endsWith(".log")) continue;

      const filepath = join(logDir, file);
      const stats = statSync(filepath);

      if (stats.mtimeMs < cutoff) {
        unlinkSync(filepath);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

function printDryRunSummary(transactions: EnrichedTransaction[]) {
  const summary = calculateSummary(transactions);

  console.log("\n--- Dry Run Summary ---");

  for (const [account, data] of summary.byAccount) {
    console.log(`\n${account}: ${data.count} transactions`);
    console.log(`  Outflow: ₪${data.outflow.toFixed(2)}`);
    console.log(`  Inflow: ₪${data.inflow.toFixed(2)}`);
  }

  console.log("\n--- Totals ---");
  console.log(`Transactions: ${transactions.length}`);
  console.log(`Outflow: ₪${summary.totalOutflow.toFixed(2)}`);
  console.log(`Inflow: ₪${summary.totalInflow.toFixed(2)}`);
}
