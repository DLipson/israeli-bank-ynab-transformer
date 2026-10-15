import type { YnabTransaction } from "../ynab/categorize.js";
import { pastMonths, type SpendItem } from "./baseline.js";
import type { MonthCategory } from "./safe-spending.js";

export interface MonthlyFlow {
  month: string;
  expenses: number;
  income: number;
  incomeThisMonth: number;
  carriedIncome: number;
  carryoverFrom: string;
  carryoverTo: string;
}

export function monthlyFlowFor(
  transactions: YnabTransaction[],
  items: SpendItem[],
  categories: MonthCategory[],
  today: string
): MonthlyFlow {
  const month = today.slice(0, 7);
  const previous = pastMonths(today, 1)[0];
  const lastDay = new Date(Date.UTC(Number(previous.slice(0, 4)), Number(previous.slice(5, 7)), 0)).getUTCDate();
  const carryoverFrom = `${previous}-${String(Math.max(1, lastDay - 6)).padStart(2, "0")}`;
  const carryoverTo = `${previous}-${String(lastDay).padStart(2, "0")}`;
  const incomeCategoryIds = new Set(
    categories.filter((c) => c.category_group_name === "Internal Master Category").map((c) => c.id)
  );
  const income = transactions.flatMap((t) => {
    if (t.deleted) return [];
    const parts = t.subtransactions as
      | Array<{
          amount: number;
          category_id: string | null;
          category_name: string | null;
          transfer_account_id: string | null;
          deleted: boolean;
        }>
      | undefined;
    const lines = parts?.length
      ? parts.filter((p) => !p.deleted)
      : [
          {
            amount: t.amount,
            category_id: t.category_id,
            category_name: t.category_name,
            transfer_account_id: t.transfer_account_id,
          },
        ];
    return lines
      .filter(
        (p) =>
          !p.transfer_account_id &&
          p.amount > 0 &&
          (!p.category_id ||
            incomeCategoryIds.has(p.category_id) ||
            p.category_name === "Inflow: Ready to Assign")
      )
      .map((p) => ({ date: t.date, amount: p.amount }));
  });
  const incomeThisMonth = income
    .filter((i) => i.date.startsWith(month) && i.date <= today)
    .reduce((sum, i) => sum + i.amount, 0);
  const carriedIncome = income
    .filter((i) => i.date >= carryoverFrom && i.date <= carryoverTo)
    .reduce((sum, i) => sum + i.amount, 0);

  return {
    month,
    expenses: items
      .filter(
        (i) =>
          i.date.startsWith(month) &&
          i.date <= today &&
          !incomeCategoryIds.has(i.categoryId) &&
          !(i.categoryId === "Uncategorized" && i.amount < 0)
      )
      .reduce((sum, i) => sum + i.amount, 0),
    income: incomeThisMonth + carriedIncome,
    incomeThisMonth,
    carriedIncome,
    carryoverFrom,
    carryoverTo,
  };
}
