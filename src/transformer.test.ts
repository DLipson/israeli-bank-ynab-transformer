import { describe, it, expect } from "vitest";
import {
  parseInstallments,
  adjustInstallmentDate,
  formatDate,
  parseDate,
  buildMemo,
  shouldSkipTransaction,
  transformTransaction,
  transformTransactions,
  groupByAccount,
  filterAndPartition,
  calculateSummary,
  type EnrichedTransaction,
} from "./transformer.js";

describe("parseInstallments", () => {
  it("parses Hebrew format: תשלום X מ-Y", () => {
    expect(parseInstallments("תשלום 2 מ-12")).toEqual({ number: 2, total: 12 });
    expect(parseInstallments("תשלום 1 מ-3")).toEqual({ number: 1, total: 3 });
    expect(parseInstallments("תשלום 12 מ-12")).toEqual({ number: 12, total: 12 });
  });

  it("parses Hebrew format with dashes: תשלום - X מ - Y", () => {
    expect(parseInstallments("תשלום - 2 מ - 12")).toEqual({ number: 2, total: 12 });
    expect(parseInstallments("תשלום -3 מ- 6")).toEqual({ number: 3, total: 6 });
  });

  it("parses Hebrew alternate format: X מתוך Y", () => {
    expect(parseInstallments("2 מתוך 12")).toEqual({ number: 2, total: 12 });
    expect(parseInstallments("תשלום 5 מתוך 10")).toEqual({ number: 5, total: 10 });
  });

  it("parses English format: payment X of Y", () => {
    expect(parseInstallments("payment 2 of 12")).toEqual({ number: 2, total: 12 });
    expect(parseInstallments("Payment 1 of 6")).toEqual({ number: 1, total: 6 });
  });

  it("returns null for non-installment text", () => {
    expect(parseInstallments("רכישה רגילה")).toBeNull();
    expect(parseInstallments("סופר פארם")).toBeNull();
    expect(parseInstallments("")).toBeNull();
  });

  it("returns null for invalid installment numbers", () => {
    // number > total is invalid
    expect(parseInstallments("תשלום 15 מ-12")).toBeNull();
    // zero values are invalid
    expect(parseInstallments("תשלום 0 מ-12")).toBeNull();
  });
});

describe("parseDate", () => {
  it("parses ISO date strings", () => {
    const date = parseDate("2024-03-15T00:00:00+02:00");
    expect(date).toBeInstanceOf(Date);
    expect(date?.getFullYear()).toBe(2024);
  });

  it("parses simple date strings", () => {
    const date = parseDate("2024-03-15");
    expect(date).toBeInstanceOf(Date);
  });

  it("returns null for invalid dates", () => {
    expect(parseDate("not-a-date")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("formatDate", () => {
  it("formats Date objects as YYYY-MM-DD", () => {
    const date = new Date(2024, 2, 15); // March 15, 2024
    expect(formatDate(date)).toBe("2024-03-15");
  });

  it("formats ISO strings as YYYY-MM-DD", () => {
    expect(formatDate("2024-03-15T10:30:00Z")).toBe("2024-03-15");
  });

  it("pads single-digit months and days", () => {
    const date = new Date(2024, 0, 5); // January 5, 2024
    expect(formatDate(date)).toBe("2024-01-05");
  });

  it("throws for invalid dates", () => {
    expect(() => formatDate("invalid")).toThrow("Invalid date");
  });
});

describe("adjustInstallmentDate", () => {
  it("returns original date for installment 1", () => {
    expect(adjustInstallmentDate("2024-03-15", 1)).toBe("2024-03-15");
  });

  it("adds days for subsequent installments", () => {
    expect(adjustInstallmentDate("2024-03-15", 2)).toBe("2024-03-16");
    expect(adjustInstallmentDate("2024-03-15", 3)).toBe("2024-03-17");
    expect(adjustInstallmentDate("2024-03-15", 12)).toBe("2024-03-26");
  });

  it("handles month boundaries", () => {
    expect(adjustInstallmentDate("2024-03-30", 5)).toBe("2024-04-03");
  });

  it("returns original string for invalid dates", () => {
    expect(adjustInstallmentDate("invalid", 2)).toBe("invalid");
  });
});

describe("buildMemo", () => {
  const baseTxn: EnrichedTransaction = {
    type: "normal" as any,
    date: "2024-03-15",
    processedDate: "2024-03-15",
    originalAmount: -100,
    originalCurrency: "ILS",
    chargedAmount: -100,
    description: "Test",
    status: "completed" as any,
  };

  it("returns empty string when no processedDate and no other metadata", () => {
    // Transaction with no processedDate and no enrichment data
    const minimalTxn: EnrichedTransaction = {
      type: "normal" as any,
      date: "2024-03-15",
      processedDate: "", // Empty processedDate
      originalAmount: -100,
      originalCurrency: "ILS",
      chargedAmount: -100,
      description: "Test",
      status: "completed" as any,
    };
    expect(buildMemo(minimalTxn, null)).toBe("");
  });

  it("always includes chargeDate when processedDate exists", () => {
    const memo = JSON.parse(buildMemo(baseTxn, null));
    expect(memo.chargeDate).toBe("2024-03-15");
  });

  it("includes transactionDate when different from processedDate", () => {
    const txn = { ...baseTxn, date: "2024-03-10", processedDate: "2024-03-15" };
    const memo = JSON.parse(buildMemo(txn, null));
    expect(memo.transactionDate).toBe("2024-03-10");
    expect(memo.chargeDate).toBe("2024-03-15");
  });

  it("includes installment info", () => {
    const memo = JSON.parse(buildMemo(baseTxn, { number: 2, total: 12 }));
    expect(memo.installment).toBe("2/12");
  });

  it("includes original amount for foreign currency", () => {
    const txn = { ...baseTxn, originalAmount: 50, originalCurrency: "USD", chargedAmount: -180 };
    const memo = JSON.parse(buildMemo(txn, null));
    expect(memo.originalAmount).toBe(50);
    expect(memo.originalCurrency).toBe("USD");
  });

  it("includes account info", () => {
    const txn = { ...baseTxn, accountNumber: "1234", accountName: "Leumi" };
    const memo = JSON.parse(buildMemo(txn, null));
    expect(memo.account).toBe("1234");
    expect(memo.source).toBe("Leumi");
  });

  it("includes reference number", () => {
    const txn = { ...baseTxn, identifier: "REF123" };
    const memo = JSON.parse(buildMemo(txn, null));
    expect(memo.ref).toBe("REF123");
  });

  it("excludes type when normal", () => {
    // baseTxn has type: "normal" - verify it's not included in memo
    const txn = { ...baseTxn, accountName: "Test" }; // Add accountName so memo isn't empty
    const memo = JSON.parse(buildMemo(txn, null));
    expect(memo.type).toBeUndefined();
    expect(memo.source).toBe("Test");
  });

  it("includes type when not normal", () => {
    const txn = { ...baseTxn, type: "installments" as any, accountName: "Test" };
    const memo = JSON.parse(buildMemo(txn, null));
    expect(memo.type).toBe("installments");
  });
});

describe("shouldSkipTransaction", () => {
  const baseTxn: EnrichedTransaction = {
    type: "normal" as any,
    date: "2024-03-15",
    processedDate: "2024-03-15",
    originalAmount: 100,
    originalCurrency: "ILS",
    chargedAmount: -100,
    description: "Test",
    status: "completed" as any,
  };

  it("returns false for completed transactions", () => {
    expect(shouldSkipTransaction(baseTxn)).toBe(false);
  });

  it("returns true for pending transactions", () => {
    const txn = { ...baseTxn, status: "pending" as any };
    expect(shouldSkipTransaction(txn)).toBe(true);
  });

  it("returns true for zero amount", () => {
    const txn = { ...baseTxn, chargedAmount: 0 };
    expect(shouldSkipTransaction(txn)).toBe(true);
  });
});

describe("transformTransaction", () => {
  const baseTxn: EnrichedTransaction = {
    type: "normal" as any,
    date: "2024-03-15T00:00:00+02:00",
    processedDate: "2024-03-15T00:00:00+02:00",
    originalAmount: 150,
    originalCurrency: "ILS",
    chargedAmount: -150,
    description: "סופר פארם",
    status: "completed" as any,
    accountName: "Max",
  };

  it("transforms expense (negative amount) to outflow", () => {
    const row = transformTransaction(baseTxn);
    expect(row).not.toBeNull();
    expect(row!.outflow).toBe("150.00");
    expect(row!.inflow).toBe("");
  });

  it("transforms income (positive amount) to inflow", () => {
    const txn = { ...baseTxn, chargedAmount: 500 };
    const row = transformTransaction(txn);
    expect(row!.outflow).toBe("");
    expect(row!.inflow).toBe("500.00");
  });

  it("formats date as YYYY-MM-DD", () => {
    const row = transformTransaction(baseTxn);
    expect(row!.date).toBe("2024-03-15");
  });

  it("trims payee description", () => {
    const txn = { ...baseTxn, description: "  סופר פארם  " };
    const row = transformTransaction(txn);
    expect(row!.payee).toBe("סופר פארם");
  });

  it("returns null for pending transactions", () => {
    const txn = { ...baseTxn, status: "pending" as any };
    expect(transformTransaction(txn)).toBeNull();
  });

  it("adjusts date for installment 2+", () => {
    const txn = { ...baseTxn, description: "רכישה תשלום 3 מ-12" };
    const row = transformTransaction(txn);
    expect(row!.date).toBe("2024-03-17"); // +2 days for installment 3
  });

  it("does not adjust date for installment 1", () => {
    const txn = { ...baseTxn, description: "רכישה תשלום 1 מ-12" };
    const row = transformTransaction(txn);
    expect(row!.date).toBe("2024-03-15");
  });
});

describe("transformTransactions", () => {
  const makeTxn = (date: string, amount: number): EnrichedTransaction => ({
    type: "normal" as any,
    date,
    processedDate: date,
    originalAmount: Math.abs(amount),
    originalCurrency: "ILS",
    chargedAmount: amount,
    description: "Test",
    status: "completed" as any,
  });

  it("transforms array of transactions", () => {
    const txns = [makeTxn("2024-03-15", -100), makeTxn("2024-03-16", -200)];
    const rows = transformTransactions(txns);
    expect(rows).toHaveLength(2);
  });

  it("filters out invalid transactions", () => {
    const txns = [
      makeTxn("2024-03-15", -100),
      { ...makeTxn("2024-03-16", -200), status: "pending" as any },
    ];
    const rows = transformTransactions(txns);
    expect(rows).toHaveLength(1);
  });

  it("sorts by date descending (newest first)", () => {
    const txns = [
      makeTxn("2024-03-10", -100),
      makeTxn("2024-03-20", -200),
      makeTxn("2024-03-15", -150),
    ];
    const rows = transformTransactions(txns);
    expect(rows[0].date).toBe("2024-03-20");
    expect(rows[1].date).toBe("2024-03-15");
    expect(rows[2].date).toBe("2024-03-10");
  });

  it("returns empty array for empty input", () => {
    expect(transformTransactions([])).toEqual([]);
  });
});

describe("groupByAccount", () => {
  const makeTxn = (accountName: string, amount: number): EnrichedTransaction => ({
    type: "normal" as any,
    date: "2024-03-15",
    processedDate: "2024-03-15",
    originalAmount: Math.abs(amount),
    originalCurrency: "ILS",
    chargedAmount: amount,
    description: "Test",
    status: "completed" as any,
    accountName,
  });

  it("groups transactions by account name", () => {
    const txns = [makeTxn("Max", -100), makeTxn("Leumi", -200), makeTxn("Max", -50)];
    const result = groupByAccount(txns);
    expect(result.size).toBe(2);
    expect(result.get("Max")).toHaveLength(2);
    expect(result.get("Leumi")).toHaveLength(1);
  });

  it("uses 'unknown' for missing account name", () => {
    const txn: EnrichedTransaction = {
      type: "normal" as any,
      date: "2024-03-15",
      processedDate: "2024-03-15",
      originalAmount: 100,
      originalCurrency: "ILS",
      chargedAmount: -100,
      description: "Test",
      status: "completed" as any,
    };
    const result = groupByAccount([txn]);
    expect(result.has("unknown")).toBe(true);
  });

  it("returns empty map for empty input", () => {
    expect(groupByAccount([]).size).toBe(0);
  });
});

describe("filterAndPartition", () => {
  const makeTxn = (status: string, amount: number): EnrichedTransaction => ({
    type: "normal" as any,
    date: "2024-03-15",
    processedDate: "2024-03-15",
    originalAmount: Math.abs(amount),
    originalCurrency: "ILS",
    chargedAmount: amount,
    description: "Test",
    status: status as any,
  });

  it("keeps completed transactions with non-zero amounts", () => {
    const txns = [makeTxn("completed", -100), makeTxn("completed", 50)];
    const { kept, skipped } = filterAndPartition(txns);
    expect(kept).toHaveLength(2);
    expect(skipped).toHaveLength(0);
  });

  it("skips pending transactions with reason", () => {
    const txns = [makeTxn("pending", -100)];
    const { kept, skipped } = filterAndPartition(txns);
    expect(kept).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBe("Pending");
  });

  it("skips zero-amount transactions with reason", () => {
    const txns = [makeTxn("completed", 0)];
    const { kept, skipped } = filterAndPartition(txns);
    expect(kept).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBe("Zero amount");
  });

  it("partitions mixed transactions", () => {
    const txns = [
      makeTxn("completed", -100),
      makeTxn("pending", -200),
      makeTxn("completed", 0),
      makeTxn("completed", 50),
    ];
    const { kept, skipped } = filterAndPartition(txns);
    expect(kept).toHaveLength(2);
    expect(skipped).toHaveLength(2);
  });

  it("returns empty arrays for empty input", () => {
    const { kept, skipped } = filterAndPartition([]);
    expect(kept).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });
});

describe("calculateSummary", () => {
  const makeTxn = (accountName: string, amount: number): EnrichedTransaction => ({
    type: "normal" as any,
    date: "2024-03-15",
    processedDate: "2024-03-15",
    originalAmount: Math.abs(amount),
    originalCurrency: "ILS",
    chargedAmount: amount,
    description: "Test",
    status: "completed" as any,
    accountName,
  });

  it("calculates per-account and total summaries", () => {
    const txns = [
      makeTxn("Max", -100),
      makeTxn("Max", -50),
      makeTxn("Max", 200),
      makeTxn("Leumi", -300),
    ];
    const summary = calculateSummary(txns);

    expect(summary.byAccount.size).toBe(2);

    const max = summary.byAccount.get("Max")!;
    expect(max.count).toBe(3);
    expect(max.outflow).toBe(150);
    expect(max.inflow).toBe(200);

    const leumi = summary.byAccount.get("Leumi")!;
    expect(leumi.count).toBe(1);
    expect(leumi.outflow).toBe(300);
    expect(leumi.inflow).toBe(0);

    expect(summary.totalOutflow).toBe(450);
    expect(summary.totalInflow).toBe(200);
  });

  it("returns zeros for empty input", () => {
    const summary = calculateSummary([]);
    expect(summary.byAccount.size).toBe(0);
    expect(summary.totalOutflow).toBe(0);
    expect(summary.totalInflow).toBe(0);
  });
});
