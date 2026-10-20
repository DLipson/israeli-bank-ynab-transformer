import { parseBankText, readMemo, type YnabTransaction } from "../ynab/categorize.js";
import { normalizedName, pastMonths, similarPayee, type SpendItem } from "./baseline.js";
import { incomeLines, type MonthlyFlow } from "./monthly-flow.js";
import type { Account, MonthCategory } from "./safe-spending.js";
import type { CategoryComparison } from "./category-comparisons.js";

export interface TxRef {
  id: string;
  date: string;
  payee: string;
  account: string;
  category: string | null;
  amount: number;
}

export interface SpentVsIncome {
  month: string;
  spent: number;
  income: number;
  difference: number;
  daysLeft: number;
  incomeParts: Array<{
    label: string;
    amount: number;
    items: Array<TxRef & { oneTime: boolean }>;
  }>;
  /** A refund linked by "Treat as refund" shows the purchase it belongs to. */
  spendingItems: Array<TxRef & { refundOf?: { payee: string; date: string } }>;
  savedThisMonth: { amount: number; items: TxRef[] };
  reasons: CategoryComparison[];
  uncategorized: { amount: number; count: number };
}

interface IncomeRef extends TxRef {
  payer: string;
}

function payerName(transaction: YnabTransaction): string {
  const { counterparty } = parseBankText(readMemo(transaction.memo).bankText);
  return counterparty || transaction.payee_name || "Unknown payer";
}

function samePayer(a: string, b: string): boolean {
  return normalizedName(a) === normalizedName(b) || similarPayee(a, b);
}

function groupedRefs(
  lines: Array<{ transaction: YnabTransaction; date: string; amount: number; category: string | null }>
): TxRef[] {
  const groups = new Map<string, { ref: TxRef; categories: Set<string> }>();
  for (const line of lines) {
    const current = groups.get(line.transaction.id);
    if (current) {
      current.ref.amount += line.amount;
      if (line.category) current.categories.add(line.category);
    } else {
      const categories = new Set(line.category ? [line.category] : []);
      groups.set(line.transaction.id, {
        ref: {
          id: line.transaction.id,
          date: line.date,
          payee: line.transaction.payee_name ?? "",
          account: line.transaction.account_name,
          category: line.category,
          amount: line.amount,
        },
        categories,
      });
    }
  }
  return [...groups.values()].map(({ ref, categories }) => ({
    ...ref,
    category: categories.size === 1 ? [...categories][0] : null,
  }));
}

function incomeRefs(transactions: YnabTransaction[], categories: MonthCategory[]): IncomeRef[] {
  const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  return groupedRefs(incomeLines(transactions, categories)).map((ref) => ({
    ...ref,
    payer: payerName(byId.get(ref.id)!),
  }));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function oneTimeIncome(item: IncomeRef, history: IncomeRef[]): boolean {
  const payerHistory = history.filter((past) => samePayer(item.payer, past.payer));
  const monthsPaid = new Set(payerHistory.map((past) => past.date.slice(0, 7))).size;
  return monthsPaid < 3 || item.amount > 1.5 * median(payerHistory.map((past) => past.amount));
}

function lastSevenStart(month: string): string {
  const [year, monthNo] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, monthNo, 0)).getUTCDate();
  return `${month}-${String(last - 6).padStart(2, "0")}`;
}

function currentMonthSpending(
  items: SpendItem[],
  month: string,
  today: string,
  categories: MonthCategory[]
): SpendItem[] {
  const incomeCategoryIds = new Set(
    categories.filter((category) => category.category_group_name === "Internal Master Category").map((c) => c.id)
  );
  return items.filter(
    (item) =>
      item.date.startsWith(month) &&
      item.date <= today &&
      !incomeCategoryIds.has(item.categoryId) &&
      !(item.categoryId === "Uncategorized" && item.amount < 0)
  );
}

export function spendingRefs(items: SpendItem[], transactions: YnabTransaction[]): TxRef[] {
  const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const lines = items.flatMap((item) => {
    const transaction = item.transactionId ? byId.get(item.transactionId) : undefined;
    return transaction
      ? [{
          transaction,
          date: item.date,
          amount: -item.amount,
          category: item.categoryName,
        }]
      : [];
  });
  return groupedRefs(lines);
}

function savingsTransfers(
  transactions: YnabTransaction[],
  accounts: Account[],
  today: string
): { amount: number; items: TxRef[] } {
  const savingsIds = new Set(accounts.filter((account) => account.type === "savings").map((account) => account.id));
  const lines = transactions.flatMap((transaction) => {
    if (transaction.deleted || !transaction.date.startsWith(today.slice(0, 7)) || transaction.date > today) return [];
    const parts = transaction.subtransactions as
      | Array<{
          amount: number;
          transfer_account_id: string | null;
          category_name: string | null;
          deleted: boolean;
        }>
      | undefined;
    const candidates = parts?.length
      ? parts.filter((part) => !part.deleted)
      : [{ amount: transaction.amount, transfer_account_id: transaction.transfer_account_id, category_name: null, deleted: false }];
    return candidates.flatMap((part) =>
      part.transfer_account_id && savingsIds.has(part.transfer_account_id) && part.amount < 0
        ? [{ transaction, date: transaction.date, amount: part.amount, category: part.category_name }]
        : []
    );
  });
  const items = groupedRefs(lines);
  return { amount: -items.reduce((sum, item) => sum + item.amount, 0), items };
}

export function spentVsIncomeFor(
  transactions: YnabTransaction[],
  items: SpendItem[],
  categories: MonthCategory[],
  accounts: Account[],
  flow: MonthlyFlow,
  today: string
): SpentVsIncome {
  const month = flow.month;
  const startOfLastSeven = lastSevenStart(month);
  const income = incomeRefs(transactions, categories);
  const currentIncome = income.filter(
    (item) =>
      item.date.startsWith(month) && item.date <= today && item.date < startOfLastSeven
  );
  const carriedIncome = income.filter(
    (item) => item.date >= flow.carryoverFrom && item.date <= flow.carryoverTo
  );
  const historyMonths = new Set(pastMonths(today, 6));
  const history = income.filter((item) => historyMonths.has(item.date.slice(0, 7)));
  const incomeGroups: Array<{ label: string; payer: string; items: Array<TxRef & { oneTime: boolean }> }> = [];
  for (const item of [...carriedIncome, ...currentIncome]) {
    let group = incomeGroups.find((candidate) => samePayer(candidate.payer, item.payer));
    if (!group) {
      group = { label: item.payer, payer: item.payer, items: [] };
      incomeGroups.push(group);
    }
    group.items.push({
      id: item.id,
      date: item.date,
      payee: item.payee,
      account: item.account,
      category: item.category,
      amount: item.amount,
      oneTime: oneTimeIncome(item, history),
    });
  }
  const incomeParts = incomeGroups.map(({ label, items: incomeItems }) => ({
    label,
    amount: incomeItems.reduce((sum, item) => sum + item.amount, 0),
    items: incomeItems,
  }));
  const monthItems = currentMonthSpending(items, month, today, categories);
  const spendingItems = spendingRefs(monthItems, transactions);
  const monthLength = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const spent = monthItems.reduce((sum, item) => sum + item.amount, 0);
  return {
    month,
    spent,
    income: flow.income,
    difference: flow.income - spent,
    daysLeft: monthLength - Number(today.slice(8, 10)),
    incomeParts,
    spendingItems,
    savedThisMonth: savingsTransfers(transactions, accounts, today),
    reasons: [],
    uncategorized: {
      amount: monthItems.filter((item) => item.categoryId === "Uncategorized").reduce((sum, item) => sum + item.amount, 0),
      count: new Set(monthItems.filter((item) => item.categoryId === "Uncategorized").map((item) => item.transactionId)).size,
    },
  };
}

/** Marks each linked refund with its purchase (links are saved locally; YNAB has no such link). */
export function withRefundLinks(
  result: SpentVsIncome,
  links: Array<{ refundTxId: string; purchaseTxId: string }>,
  transactions: YnabTransaction[]
): SpentVsIncome {
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const purchaseOf = new Map(links.map((l) => [l.refundTxId, byId.get(l.purchaseTxId)]));
  return {
    ...result,
    spendingItems: result.spendingItems.map((item) => {
      const purchase = purchaseOf.get(item.id);
      return purchase ? { ...item, refundOf: { payee: purchase.payee_name ?? "", date: purchase.date } } : item;
    }),
  };
}
