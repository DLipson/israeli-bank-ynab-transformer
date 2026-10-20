/**
 * Cards tab: for each card group, the headroom and what uses the limit. On this user's cards each
 * charge pays all purchases since the previous charge, so the card balance is the next payment.
 */
import { readMemoFields, type YnabTransaction } from "../ynab/categorize.js";
import { parseChargeDate } from "./charge-date.js";
import { formatShekels, installmentPlans, type Snapshot } from "./safe-spending.js";
import { isMeaningful, type CategoryComparison } from "./category-comparisons.js";
import type { TxRef } from "./spent-vs-income.js";

export interface CardGroup {
  name: string;
  limit: number | null;
  balance: number;
  futureInstallments: number;
  headroom: number | null;
  state: "ok" | "low" | "over" | "no-limit";
  nextPayment: {
    date: string | null;
    total: number;
    newPurchases: { amount: number; items: TxRef[] };
    olderInstallments: { amount: number; items: Array<TxRef & { payment: string }> };
  };
  futureByMonth: Array<{
    month: string;
    amount: number;
    plans: Array<{ payee: string; account: string; payment: number; paymentsLeft: number }>;
  }>;
}

const OWED_TYPES = new Set(["creditCard", "lineOfCredit"]);
/** With no card payment in the data, charges from the last 45 days are taken as the balance. */
const NO_PAYMENT_DAYS = 45;

function ref(t: YnabTransaction): TxRef {
  return { id: t.id, date: t.date, payee: t.payee_name ?? "", account: t.account_name, category: t.category_name, amount: t.amount };
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

function monthAfter(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * The charges still in a card's balance: not a transfer, and charged (memo chargeDate, or the date
 * when there is none) after the newest payment into the card.
 */
function unpaid(transactions: YnabTransaction[], accountId: string, today: string): YnabTransaction[] {
  const own = transactions.filter((t) => !t.deleted && t.account_id === accountId);
  const lastPayment = own
    .filter((t) => t.transfer_account_id && t.amount > 0)
    .reduce<string | null>((max, t) => (max === null || t.date > max ? t.date : max), null);
  const after = lastPayment ?? addDays(today, -NO_PAYMENT_DAYS);
  return own
    .filter((t) => !t.transfer_account_id && (parseChargeDate(t.memo) ?? t.date) > after)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function installment(t: YnabTransaction): [number, number] | null {
  const value = readMemoFields(t.memo)?.installment;
  if (typeof value !== "string") return null;
  const [n, total] = value.split("/").map(Number);
  return n && total ? [n, total] : null;
}

export function cardGroups(snapshot: Snapshot): CardGroup[] {
  const { today, transactions, settings } = snapshot;
  const accounts = snapshot.accounts.filter((a) => a.on_budget && !a.closed && !a.deleted);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const plans = installmentPlans(transactions, today);
  const grouped = new Set(settings.creditLimits.flatMap((g) => g.accountIds));
  const defaults = accounts
    .filter((a) => OWED_TYPES.has(a.type) && !grouped.has(a.id))
    .map((a) => ({ name: a.name, limit: null as number | null, accountIds: [a.id] }));

  return [...settings.creditLimits, ...defaults].map((g) => {
    const members = g.accountIds.map((id) => byId.get(id)).filter((a) => a !== undefined);
    const balance = members.reduce((sum, a) => sum + Math.max(0, -a.balance), 0);
    const charges = members.flatMap((a) => unpaid(transactions, a.id, today));
    const older = charges.flatMap((t) => {
      const parts = installment(t);
      return parts && parts[0] >= 2 ? [{ ...ref(t), payment: `${parts[0]} of ${parts[1]}` }] : [];
    });
    const olderIds = new Set(older.map((t) => t.id));
    const olderAmount = -older.reduce((sum, t) => sum + t.amount, 0);
    const newItems = charges.filter((t) => !olderIds.has(t.id)).map(ref);
    const newAmount = balance - olderAmount;
    // Starting balances, reconcile adjustments, or a payment not imported yet: show what the
    // listed charges do not explain, so the drill-down adds up to the balance.
    const rest = newAmount + newItems.reduce((sum, t) => sum + t.amount, 0);
    if (rest !== 0) {
      newItems.push({ id: `rest:${g.name}`, date: today, payee: "Earlier balance and adjustments", account: "", category: null, amount: -rest });
    }
    const chargeDates = charges.map((t) => parseChargeDate(t.memo)).filter((d) => d !== null);
    const date = chargeDates.length ? chargeDates.reduce((max, d) => (d > max ? d : max)) : null;

    const groupPlans = plans.filter((p) => g.accountIds.includes(p.accountId));
    const futureInstallments = groupPlans.reduce((sum, p) => sum + p.remaining, 0);
    const months = new Map<string, CardGroup["futureByMonth"][number]>();
    for (const p of groupPlans) {
      const left = p.total - p.paid;
      for (let ahead = 1; ahead <= left; ahead++) {
        const month = monthAfter(p.lastCharge.slice(0, 7), ahead);
        const entry = months.get(month) ?? { month, amount: 0, plans: [] };
        entry.amount += p.payment;
        entry.plans.push({ payee: p.payee, account: byId.get(p.accountId)?.name ?? "", payment: p.payment, paymentsLeft: left - ahead + 1 });
        months.set(month, entry);
      }
    }

    const headroom = g.limit === null ? null : g.limit - balance - futureInstallments;
    const state: CardGroup["state"] =
      headroom === null ? "no-limit" : headroom < 0 ? "over" : headroom < settings.cardWarningLevel ? "low" : "ok";
    return {
      name: g.name,
      limit: g.limit,
      balance,
      futureInstallments,
      headroom,
      state,
      nextPayment: {
        date,
        total: balance,
        newPurchases: { amount: newAmount, items: newItems },
        olderInstallments: { amount: olderAmount, items: older },
      },
      futureByMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    };
  });
}

export interface WatchItem {
  kind: "card-low" | "card-over" | "essential-over-pace";
  label: string;
  target: { tab: "cards"; group: string } | { tab: "home"; categoryId: string };
}

/** "Things to watch": true now, no memory. Spending above income is not here: the bar shows it. */
export function watchItems(groups: CardGroup[], comparisons: CategoryComparison[]): WatchItem[] {
  const cards = groups.flatMap((g): WatchItem[] =>
    g.state === "over"
      ? [{ kind: "card-over", label: `${g.name}: ${formatShekels(-g.headroom!)} over the limit`, target: { tab: "cards", group: g.name } }]
      : g.state === "low"
        ? [{ kind: "card-low", label: `${g.name}: only ${formatShekels(g.headroom!)} left`, target: { tab: "cards", group: g.name } }]
        : []
  );
  const essentials = comparisons
    .filter((c) => c.type === "essential" && isMeaningful(c))
    .map((c): WatchItem => ({
      kind: "essential-over-pace",
      label: `${c.name}: ${formatShekels(c.difference)} over the normal by this day`,
      target: { tab: "home", categoryId: c.categoryId },
    }));
  return [...cards, ...essentials];
}
