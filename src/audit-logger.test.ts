import { describe, it, expect } from "vitest";
import { createAuditLogger, formatAuditLog } from "./audit-logger.js";
import type { ScrapeResult } from "./scraper.js";
import type { EnrichedTransaction, YnabRow } from "./transformer.js";

describe("createAuditLogger", () => {
  it("records scrape results by account", () => {
    const logger = createAuditLogger();

    const results: ScrapeResult[] = [
      {
        accountName: "Max",
        success: true,
        transactions: [
          makeTxn(-100),
          makeTxn(-50),
          makeTxn(200),
        ],
      },
      {
        accountName: "Leumi",
        success: true,
        transactions: [makeTxn(-300)],
      },
    ];

    logger.recordScrapeResults(results);

    const log = logger.getLog();

    expect(log.accounts).toHaveLength(2);
    expect(log.accounts[0].name).toBe("Max");
    expect(log.accounts[0].transactionCount).toBe(3);
    expect(log.accounts[0].totalOutflow).toBe(150);
    expect(log.accounts[0].totalInflow).toBe(200);
    expect(log.accounts[1].name).toBe("Leumi");
    expect(log.accounts[1].totalOutflow).toBe(300);
  });

  it("skips failed accounts", () => {
    const logger = createAuditLogger();

    const results: ScrapeResult[] = [
      {
        accountName: "Failed",
        success: false,
        transactions: [],
        error: "Login failed",
      },
    ];

    logger.recordScrapeResults(results);

    const log = logger.getLog();

    expect(log.accounts).toHaveLength(0);
  });

  it("records skipped transactions", () => {
    const logger = createAuditLogger();

    const txn: EnrichedTransaction = {
      date: "2024-03-15T00:00:00+02:00",
      processedDate: "2024-03-15T00:00:00+02:00",
      originalAmount: 100,
      originalCurrency: "ILS",
      chargedAmount: 0,
      description: "Cancelled Transaction",
      status: "completed" as any,
      type: "normal" as any,
    };

    logger.recordSkipped(txn, "Zero amount");

    const log = logger.getLog();

    expect(log.skipped).toHaveLength(1);
    expect(log.skipped[0].reason).toBe("Zero amount");
    expect(log.skipped[0].description).toBe("Cancelled Transaction");
  });

  it("records output with checksum", () => {
    const logger = createAuditLogger();

    const rows: YnabRow[] = [
      { date: "2024-03-15", payee: "Store", memo: "", outflow: "150.00", inflow: "" },
      { date: "2024-03-16", payee: "Salary", memo: "", outflow: "", inflow: "5000.00" },
    ];

    logger.recordOutput(rows, "/output/test.csv", "csv content here");

    const log = logger.getLog();

    expect(log.outputFile).toBe("/output/test.csv");
    expect(log.outputTransactionCount).toBe(2);
    expect(log.totalOutflow).toBe(150);
    expect(log.totalInflow).toBe(5000);
    expect(log.checksum).toHaveLength(16);
  });

  it("has timestamp", () => {
    const logger = createAuditLogger();
    const log = logger.getLog();

    expect(log.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("omits raw scraper results from formatted audit logs", () => {
    const logger = createAuditLogger();
    const log = logger.getLog() as any;

    log.rawScraperResults = [
      {
        accountName: "Max",
        success: true,
        transactions: [makeTxn(-25)],
      },
    ];

    log.transformationDetails = [
      {
        raw: makeTxn(-25),
        transformed: {
          date: "2024-03-15",
          payee: "Store",
          memo: "",
          outflow: "25.00",
          inflow: "",
        },
      },
    ];

    const formatted = formatAuditLog(log);

    expect(formatted).toContain("Transformation Details:");
    expect(formatted).not.toContain("Raw Scraper Results:");
  });
});

function makeTxn(amount: number): EnrichedTransaction {
  return {
    date: "2024-03-15T00:00:00+02:00",
    processedDate: "2024-03-15T00:00:00+02:00",
    originalAmount: Math.abs(amount),
    originalCurrency: "ILS",
    chargedAmount: amount,
    description: "Test Transaction",
    status: "completed" as any,
    type: "normal" as any,
  };
}
