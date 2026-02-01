import type {
  Transaction,
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions";

export interface YnabRow {
  date: string;
  payee: string;
  memo: string;
  outflow: string;
  inflow: string;
}

export interface EnrichedTransaction extends Transaction {
  accountNumber?: string;
  accountName?: string;
}

export interface InstallmentInfo {
  number: number;
  total: number;
}

/**
 * Patterns for detecting installment transactions in descriptions.
 * Order matters - more specific patterns should come first.
 */
const INSTALLMENT_PATTERNS: RegExp[] = [
  // Hebrew: "תשלום 2 מ-12" or "תשלום - 2 מ - 12"
  /תשלום\s*(?:-\s*)?(\d+)\s*מ(?:תוך)?\s*-?\s*(\d+)/,
  // Hebrew alternate: "2 מתוך 12"
  /(\d+)\s*מתוך\s*(\d+)/,
  // English: "payment 2 of 12"
  /payment\s*(\d+)\s*of\s*(\d+)/i,
];

/**
 * Parse installment info from transaction description.
 *
 * @example
 * parseInstallments("תשלום 2 מ-12") // { number: 2, total: 12 }
 * parseInstallments("רכישה רגילה")  // null
 */
export function parseInstallments(text: string): InstallmentInfo | null {
  for (const pattern of INSTALLMENT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const number = parseInt(match[1], 10);
      const total = parseInt(match[2], 10);

      // Validate parsed values
      if (number > 0 && total > 0 && number <= total) {
        return { number, total };
      }
    }
  }
  return null;
}

/**
 * Adjust date for installment transactions to prevent YNAB duplicate detection.
 *
 * YNAB flags transactions with same date/amount as duplicates. For installments,
 * we spread them across different days:
 * - Installment 1: original date
 * - Installment 2: original date + 1 day
 * - Installment 3: original date + 2 days
 * - etc.
 *
 * @param isoDate - ISO date string from scraper
 * @param installmentNumber - Which installment (1-based)
 */
export function adjustInstallmentDate(isoDate: string, installmentNumber: number): string {
  const date = parseDate(isoDate);
  if (!date) {
    return isoDate; // Return original if parsing fails
  }

  // Spread installments: add (installmentNumber - 1) days
  // Installment 1 = no change, 2 = +1 day, 3 = +2 days, etc.
  if (installmentNumber > 1) {
    date.setDate(date.getDate() + (installmentNumber - 1));
  }

  return formatDate(date);
}

/**
 * Parse a date string into a Date object.
 * Returns null for invalid dates.
 */
export function parseDate(input: string): Date | null {
  const date = new Date(input);
  if (isNaN(date.getTime())) {
    return null;
  }
  return date;
}

/**
 * Format date as YYYY-MM-DD (YNAB's expected format).
 */
export function formatDate(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${String(input)}`);
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * Build memo field as JSON with transaction metadata.
 * Only includes fields that have meaningful values.
 */
export function buildMemo(txn: EnrichedTransaction, installments: InstallmentInfo | null): string {
  const memo: Record<string, unknown> = {};

  // Include original transaction date if different from processed date
  if (txn.date && txn.processedDate && txn.date !== txn.processedDate) {
    const txnDate = parseDate(txn.date);
    if (txnDate) {
      memo.transactionDate = formatDate(txnDate);
    }
  }

  // Charge/processed date
  if (txn.processedDate) {
    const chargeDate = parseDate(txn.processedDate);
    if (chargeDate) {
      memo.chargeDate = formatDate(chargeDate);
    }
  }

  // Installment info (prefer parsed from description, fall back to transaction data)
  if (installments) {
    memo.installment = `${installments.number}/${installments.total}`;
  } else if (txn.installments?.number && txn.installments?.total) {
    memo.installment = `${txn.installments.number}/${txn.installments.total}`;
  }

  // Original amount if different from charged (foreign currency transactions)
  if (
    txn.originalAmount !== undefined &&
    txn.chargedAmount !== undefined &&
    Math.abs(txn.originalAmount - txn.chargedAmount) > 0.01
  ) {
    memo.originalAmount = txn.originalAmount;
    if (txn.originalCurrency) {
      memo.originalCurrency = txn.originalCurrency;
    }
  }

  // Reference number (אסמכתא)
  if (txn.identifier) {
    memo.ref = txn.identifier;
  }

  // Account info
  if (txn.accountNumber) {
    memo.account = txn.accountNumber;
  }
  if (txn.accountName) {
    memo.source = txn.accountName;
  }

  // Transaction type (only if not "normal")
  if (txn.type && txn.type !== ("normal" as TransactionTypes)) {
    memo.type = txn.type;
  }

  // Category from bank
  if (txn.category) {
    memo.category = txn.category;
  }

  // Additional memo from bank
  if (txn.memo) {
    memo.bankMemo = txn.memo;
  }

  // Return empty string if no metadata
  if (Object.keys(memo).length === 0) {
    return "";
  }

  return JSON.stringify(memo);
}

/**
 * Check if a transaction should be skipped.
 */
export function shouldSkipTransaction(txn: EnrichedTransaction): boolean {
  // Skip pending transactions
  if (txn.status === ("pending" as TransactionStatuses)) {
    return true;
  }

  // Skip transactions with no amount
  if (txn.chargedAmount === undefined || txn.chargedAmount === 0) {
    return true;
  }

  return false;
}

/**
 * Transform a bank transaction to YNAB row format.
 * Returns null for transactions that should be skipped.
 */
export function transformTransaction(txn: EnrichedTransaction): YnabRow | null {
  if (shouldSkipTransaction(txn)) {
    return null;
  }

  // Parse installments from description
  const installments =
    parseInstallments(txn.description) ||
    (txn.installments?.number && txn.installments?.total
      ? { number: txn.installments.number, total: txn.installments.total }
      : null);

  // Determine the date to use (prefer charge date, fall back to transaction date)
  const rawDate = txn.processedDate || txn.date;
  if (!rawDate) {
    return null;
  }

  // Format date, adjusting for installments if needed
  let date: string;
  if (installments && installments.number > 1) {
    date = adjustInstallmentDate(rawDate, installments.number);
  } else {
    const parsed = parseDate(rawDate);
    if (!parsed) {
      return null;
    }
    date = formatDate(parsed);
  }

  // Determine inflow/outflow (negative = expense, positive = income/refund)
  const amount = txn.chargedAmount;
  const outflow = amount < 0 ? Math.abs(amount).toFixed(2) : "";
  const inflow = amount > 0 ? amount.toFixed(2) : "";

  // Build memo with metadata
  const memo = buildMemo(txn, installments);

  return {
    date,
    payee: txn.description.trim(),
    memo,
    outflow,
    inflow,
  };
}

/**
 * Transform all transactions from scraper results to YNAB format.
 * Filters out invalid transactions and sorts by date (newest first).
 */
export function transformTransactions(transactions: EnrichedTransaction[]): YnabRow[] {
  const rows: YnabRow[] = [];

  for (const txn of transactions) {
    const row = transformTransaction(txn);
    if (row) {
      rows.push(row);
    }
  }

  // Sort by date descending (newest first)
  rows.sort((a, b) => b.date.localeCompare(a.date));

  return rows;
}

/**
 * Group transactions by account name.
 */
export function groupByAccount(transactions: EnrichedTransaction[]): Map<string, EnrichedTransaction[]> {
  const byAccount = new Map<string, EnrichedTransaction[]>();

  for (const txn of transactions) {
    const key = txn.accountName ?? "unknown";
    const list = byAccount.get(key) ?? [];
    list.push(txn);
    byAccount.set(key, list);
  }

  return byAccount;
}

export interface SkippedItem {
  txn: EnrichedTransaction;
  reason: string;
}

/**
 * Partition transactions into kept and skipped, with skip reasons.
 */
export function filterAndPartition(
  transactions: EnrichedTransaction[]
): { kept: EnrichedTransaction[]; skipped: SkippedItem[] } {
  const kept: EnrichedTransaction[] = [];
  const skipped: SkippedItem[] = [];

  for (const txn of transactions) {
    if (shouldSkipTransaction(txn)) {
      const reason = txn.status === ("pending" as TransactionStatuses) ? "Pending" : "Zero amount";
      skipped.push({ txn, reason });
    } else {
      kept.push(txn);
    }
  }

  return { kept, skipped };
}

export interface AccountSummaryData {
  count: number;
  outflow: number;
  inflow: number;
}

export interface TransactionSummary {
  byAccount: Map<string, AccountSummaryData>;
  totalOutflow: number;
  totalInflow: number;
}

/**
 * Calculate summary statistics for a set of transactions.
 */
export function calculateSummary(transactions: EnrichedTransaction[]): TransactionSummary {
  const byAccount = new Map<string, AccountSummaryData>();
  let totalOutflow = 0;
  let totalInflow = 0;

  for (const txn of transactions) {
    const key = txn.accountName ?? "unknown";
    const existing = byAccount.get(key) ?? { count: 0, outflow: 0, inflow: 0 };

    const amount = txn.chargedAmount ?? 0;
    if (amount < 0) existing.outflow += Math.abs(amount);
    if (amount > 0) existing.inflow += amount;
    existing.count++;

    byAccount.set(key, existing);
  }

  for (const summary of byAccount.values()) {
    totalOutflow += summary.outflow;
    totalInflow += summary.inflow;
  }

  return { byAccount, totalOutflow, totalInflow };
}
