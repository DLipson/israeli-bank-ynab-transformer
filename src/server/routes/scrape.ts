import { Router, type Request, type Response } from "express";
import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { loadConfig } from "../../config.js";
import { scrapeAllAccounts } from "../../scraper.js";
import {
  filterAndPartition,
  transformTransaction,
  transformTransactions,
  calculateSummary,
  groupByAccount,
  type YnabRow,
  type EnrichedTransaction,
} from "../../transformer.js";
import { toCSV, generateFilename } from "../../csv-writer.js";
import { createAuditLogger, formatAuditLog, type AuditLog } from "../../audit-logger.js";
import type { ScrapeResult } from "../../scraper.js";
import type { SkippedItem } from "../../transformer.js";

const router = Router();

/**
 * GET /api/scrape/stream
 * SSE endpoint that streams scrape progress and results.
 */
router.get("/scrape/stream", async (req: Request, res: Response) => {
  const daysBack = parseInt(req.query.daysBack as string) || 60;
  const showBrowser = req.query.showBrowser === "true";
  const enableDetailedLogging = req.query.enableDetailedLogging === "true";
  const detailedLoggingLimit = parseInt(req.query.detailedLoggingLimit as string) || 0;

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  function sendEvent(data: Record<string, unknown>) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    // Load config
    const config = loadConfig({ daysBack, showBrowser });

    for (const warning of config.warnings) {
      sendEvent({ type: "warning", message: warning });
    }

    const enabledAccounts = config.accounts.filter((a) => a.enabled);
    if (enabledAccounts.length === 0) {
      sendEvent({ type: "error", message: "No accounts have credentials configured." });
      res.end();
      return;
    }

    // Scrape with progress callbacks
    const results = await scrapeAllAccounts(
      config.accounts,
      config.startDate,
      config.showBrowser,
      (message: string) => {
        sendEvent({ type: "progress", message });
      }
    );

    // Send per-account results
    for (const result of results) {
      sendEvent({
        type: "account-done",
        accountName: result.accountName,
        success: result.success,
        transactionCount: result.transactions.length,
        error: result.error,
      });
    }

    // Create audit logger and record raw scraper results if detailed logging is enabled
    const auditLogger = createAuditLogger();

    if (enableDetailedLogging) {
      auditLogger.recordRawScrapeResults(results, detailedLoggingLimit);
    }

    // Process results
    const allRawTransactions: EnrichedTransaction[] = [];
    for (const result of results) {
      if (result.success) {
        allRawTransactions.push(...result.transactions);
      }
    }

    const { kept, skipped } = filterAndPartition(allRawTransactions);

    // Track transformations if detailed logging is enabled
    const transformationPairs: Array<{ raw: EnrichedTransaction; transformed: YnabRow }> = [];
    const rows: YnabRow[] = [];

    for (const txn of kept) {
      const row = transformTransaction(txn);
      if (row) {
        rows.push(row);
        if (enableDetailedLogging) {
          transformationPairs.push({ raw: txn, transformed: row });
        }
      }
    }

    if (enableDetailedLogging && transformationPairs.length > 0) {
      auditLogger.recordTransformations(transformationPairs, detailedLoggingLimit);
    }

    // Sort by date descending (newest first)
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const summary = calculateSummary(kept);

    // Record scrape results in audit logger
    auditLogger.recordScrapeResults(results);

    // Convert Map to serializable object
    const summaryObj = {
      byAccount: Object.fromEntries(summary.byAccount),
      totalOutflow: summary.totalOutflow,
      totalInflow: summary.totalInflow,
    };

    sendEvent({
      type: "done",
      payload: {
        scrapeResults: results.map((r) => ({
          accountName: r.accountName,
          success: r.success,
          transactionCount: r.transactions.length,
          error: r.error,
        })),
        kept,
        skipped,
        rows,
        summary: summaryObj,
        auditLog: auditLogger.getLog(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendEvent({ type: "error", message });
  }

  res.end();
});

/**
 * POST /api/export
 * Writes CSV files and audit log to disk.
 */
router.post("/export", (req: Request, res: Response) => {
  const { rows, outputDir, split, scrapeResults, skipped, auditLog } = req.body as {
    rows: YnabRow[];
    outputDir: string;
    split: boolean;
    scrapeResults: Array<{
      accountName: string;
      success: boolean;
      transactionCount: number;
      error?: string;
    }>;
    skipped: SkippedItem[];
    auditLog?: any;
  };

  if (!rows || !outputDir) {
    res.status(400).json({ error: "Missing rows or outputDir" });
    return;
  }

  try {
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const csvPaths: string[] = [];

    if (split) {
      // Group rows by their source account (parse from memo JSON)
      const byAccount = new Map<string, YnabRow[]>();
      for (const row of rows) {
        let account = "unknown";
        try {
          const memo = JSON.parse(row.memo);
          if (memo.source) account = memo.source;
        } catch {
          // ignore
        }
        const list = byAccount.get(account) ?? [];
        list.push(row);
        byAccount.set(account, list);
      }

      for (const [accountName, accountRows] of byAccount) {
        const safeName = accountName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
        const filename = generateFilename(`ynab-${safeName}`);
        const outputPath = join(outputDir, filename);
        const csv = toCSV(accountRows);
        writeFileSync(outputPath, csv, "utf-8");
        csvPaths.push(outputPath);
      }
    } else {
      const filename = generateFilename();
      const outputPath = join(outputDir, filename);
      const csv = toCSV(rows);
      writeFileSync(outputPath, csv, "utf-8");
      csvPaths.push(outputPath);
    }

    // Prepare audit log
    let logToSave: AuditLog;

    if (auditLog) {
      // Use the provided audit log and just update the output information
      logToSave = { ...auditLog };
      const allCsv = toCSV(rows);
      const checksum = createHash("sha256").update(allCsv).digest("hex").slice(0, 16);

      logToSave.outputFile = csvPaths.length > 1 ? csvPaths.join(", ") : csvPaths[0];
      logToSave.outputTransactionCount = rows.length;

      for (const row of rows) {
        const outflow = parseFloat(row.outflow) || 0;
        const inflow = parseFloat(row.inflow) || 0;
        logToSave.totalOutflow = (logToSave.totalOutflow || 0) + outflow;
        logToSave.totalInflow = (logToSave.totalInflow || 0) + inflow;
      }

      logToSave.checksum = checksum;
    } else {
      // Create a new audit log (fallback for old clients)
      const auditLogger = createAuditLogger();

      if (scrapeResults) {
        auditLogger.recordScrapeResults(
          scrapeResults.map((r) => ({
            accountName: r.accountName,
            success: r.success,
            transactions: [] as EnrichedTransaction[],
            error: r.error,
          }))
        );
      }

      if (skipped) {
        for (const item of skipped) {
          auditLogger.recordSkipped(item.txn, item.reason);
        }
      }

      const allCsv = toCSV(rows);
      const outputPath = csvPaths.length > 1 ? csvPaths.join(", ") : csvPaths[0];
      auditLogger.recordOutput(rows, outputPath, allCsv);

      logToSave = auditLogger.getLog();
    }

    // Save audit log
    const logDir = "./logs";
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    const logFilename = `run-${logToSave.timestamp.replace(/:/g, "-").replace(/\.\d{3}Z$/, "")}.log`;
    const logPath = join(logDir, logFilename);
    writeFileSync(logPath, formatAuditLog(logToSave), "utf-8");

    res.json({ csvPaths, auditLogPath: logPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/open-path
 * Opens a file or folder in the OS file manager.
 */
router.post("/open-path", (req: Request, res: Response) => {
  const { path } = req.body as { path?: string };

  if (!path) {
    res.status(400).json({ error: "Missing path" });
    return;
  }

  const resolvedPath = resolve(path);

  try {
    const stats = statSync(resolvedPath);
    if (!stats.isFile() && !stats.isDirectory()) {
      res.status(400).json({ error: "Path must be a file or directory" });
      return;
    }
  } catch {
    res.status(404).json({ error: "Path not found" });
    return;
  }

  try {
    openInFileManager(resolvedPath);
    res.json({ path: resolvedPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;

function openInFileManager(targetPath: string) {
  const platform = process.platform;
  let command: string;
  let args: string[] = [];

  if (platform === "win32") {
    command = "explorer";
    args = [targetPath];
  } else if (platform === "darwin") {
    command = "open";
    args = [targetPath];
  } else {
    command = "xdg-open";
    args = [targetPath];
  }

  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}
