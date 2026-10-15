/**
 * Anomaly detectors: deterministic checks that point at things worth a look. Each finding says
 * what was found and why; the user can dismiss it. Amounts are positive milliunits.
 * Spec: docs/financial-intelligence-notes.md, "Anomaly detectors".
 */
import { identityKey, parseBankText, readMemo, type YnabTransaction } from "../ynab/categorize.js";
import type { Pace } from "./baseline.js";

export type AnomalyKind = "unusual-charge" | "new-payee" | "duplicate" | "category-spike" | "price-increase";

export interface Anomaly {
  /** Stable id, used to dismiss it. */
  id: string;
  kind: AnomalyKind;
  date: string;
  title: string;
  detail: string;
  amount: number;
  transactionIds: string[];
}

const K = 1000;
const DAY_MS = 86400000;
/** Findings look at transactions from the last 30 days. */
export const RECENT_DAYS = 30;

const UNUSUAL_FACTOR = 2;
const UNUSUAL_MIN = 150 * K;
const UNUSUAL_HISTORY = 3;
const NEW_PAYEE_MIN = 100 * K;
const DUPLICATE_DAYS = 3;
/** Small repeated fees (card fees) are normal, so duplicates need at least ₪50. */
const DUPLICATE_MIN = 50 * K;
/** A new level within 20% of the previous payment is no longer unusual. */
const SAME_LEVEL = 0.2;
const SPIKE_FACTOR = 1.25;
const SPIKE_MIN = 300 * K;
const PRICE_FACTOR = 1.1;
const PRICE_MIN = 10 * K;

function shekels(milliunits: number): string {
  return `₪${Math.round(milliunits / K).toLocaleString("en-US")}`;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
}

function monthOffset(month: string, offset: number): string {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value - 1 + offset, 1)).toISOString().slice(0, 7);
}

/** Outflows a person chooses: not transfers, cash withdrawals, installments, or splits. */
function isChoiceSpending(t: YnabTransaction): boolean {
  if (t.deleted || t.amount >= 0 || t.transfer_account_id || t.subtransactions?.length) return false;
  if (t.payee_name === "משיכת מזומן" || /^נמשך מכרטיס/.test(readMemo(t.memo).bankText)) return false;
  return !/"installment"\s*:/.test(t.memo ?? "");
}

/** The real recipient: generic bank payees ("הע. אינטרנט") hide it in the bank text. */
function payeeName(t: YnabTransaction): string {
  const { counterparty, merchant } = parseBankText(readMemo(t.memo).bankText);
  return counterparty || merchant || t.payee_name || identityKey(t);
}

/** A payee's history: every earlier outflow with the same identity, on any account. */
function byIdentity(transactions: YnabTransaction[]): Map<string, YnabTransaction[]> {
  const map = new Map<string, YnabTransaction[]>();
  for (const t of transactions) {
    if (!isChoiceSpending(t)) continue;
    const key = identityKey(t);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(t);
    else map.set(key, [t]);
  }
  for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return map;
}

export function detectAnomalies(
  transactions: YnabTransaction[],
  categories: Pace[],
  asOf: string,
  dismissed: string[] = []
): Anomaly[] {
  const since = new Date(Date.parse(`${asOf}T00:00:00Z`) - RECENT_DAYS * DAY_MS).toISOString().slice(0, 10);
  const history = byIdentity(transactions);
  const found: Anomaly[] = [];

  for (const list of history.values()) {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.date < since || t.date > asOf) continue;
      const amount = -t.amount;
      const before = list.slice(0, i).filter((x) => x.date < t.date);

      // New payee: never seen before.
      if (before.length === 0 && amount >= NEW_PAYEE_MIN) {
        found.push({
          id: `new-payee:${t.id}`,
          kind: "new-payee",
          date: t.date,
          title: `New payee: ${payeeName(t)}`,
          detail: `First payment to this payee: ${shekels(amount)} on ${t.account_name}.`,
          amount,
          transactionIds: [t.id],
        });
      }

      // Unusual charge: far above this payee's usual amount, and not a level the payee already moved to.
      const previous = before.at(-1);
      const newLevel = previous !== undefined && Math.abs(-previous.amount - amount) <= amount * SAME_LEVEL;
      const reported = found.some((a) => a.kind === "unusual-charge" && a.date === t.date && a.title.endsWith(payeeName(t)));
      if (before.length >= UNUSUAL_HISTORY && !newLevel && !reported) {
        const usual = median(before.map((x) => -x.amount));
        if (amount >= usual * UNUSUAL_FACTOR && amount - usual >= UNUSUAL_MIN) {
          found.push({
            id: `unusual-charge:${t.id}`,
            kind: "unusual-charge",
            date: t.date,
            title: `Unusual charge: ${payeeName(t)}`,
            detail: `${shekels(amount)}; usually ${shekels(usual)} (${before.length} earlier payments).`,
            amount,
            transactionIds: [t.id],
          });
        }
      }

      // Possible duplicate: same account and amount within a few days.
      for (const other of list) {
        if (other.id <= t.id || other.account_id !== t.account_id || other.amount !== t.amount || amount < DUPLICATE_MIN) continue;
        if (daysBetween(other.date, t.date) > DUPLICATE_DAYS) continue;
        const [a, b] = [t.id, other.id].sort();
        found.push({
          id: `duplicate:${a}:${b}`,
          kind: "duplicate",
          date: t.date > other.date ? t.date : other.date,
          title: `Possible duplicate: ${payeeName(t)}`,
          detail: `${shekels(amount)} twice on ${t.account_name} (${other.date} and ${t.date}). Check it is not charged twice.`,
          amount,
          transactionIds: [a, b],
        });
      }
    }
  }

  // A jump big enough to be an unusual charge is reported once, as that.
  const reportedIds = new Set(found.flatMap((a) => a.transactionIds));
  found.push(...priceIncreases(history, since, asOf).filter((p) => !reportedIds.has(p.transactionIds[0])));

  // Category spike: already well over a whole normal month.
  const month = asOf.slice(0, 7);
  for (const c of categories) {
    if (c.status.startsWith("fixed") || c.normalMonth <= 0) continue;
    if (c.thisMonth >= c.normalMonth * SPIKE_FACTOR && c.thisMonth - c.normalMonth >= SPIKE_MIN) {
      found.push({
        id: `category-spike:${month}:${c.name}`,
        kind: "category-spike",
        date: asOf,
        title: `${c.name} is over a whole normal month`,
        detail: `${shekels(c.thisMonth)} so far this month; a whole normal month is ${shekels(c.normalMonth)}.`,
        amount: c.thisMonth - c.normalMonth,
        transactionIds: [],
      });
    }
  }

  const hidden = new Set(dismissed);
  return found.filter((a) => !hidden.has(a.id)).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Price increase: a payment with a steady amount in 3 consecutive prior calendar months
 * whose newest charge is 10% and ₪10 above its usual amount.
 */
function priceIncreases(history: Map<string, YnabTransaction[]>, since: string, asOf: string): Anomaly[] {
  const found: Anomaly[] = [];
  for (const list of history.values()) {
    const latest = list.filter((t) => t.date <= asOf).at(-1);
    if (!latest || latest.date < since) continue;
    const months = new Map<string, number>();
    for (const t of list) if (t.date < latest.date.slice(0, 7)) months.set(t.date.slice(0, 7), -t.amount);
    const recent = [-3, -2, -1].map((offset) => months.get(monthOffset(latest.date.slice(0, 7), offset)));
    if (recent.some((value) => value === undefined)) continue;
    const amounts = recent as number[];
    const usual = median(amounts);
    const steady = Math.max(...amounts) <= Math.min(...amounts) * PRICE_FACTOR;
    const amount = -latest.amount;
    if (steady && amount >= usual * PRICE_FACTOR && amount - usual >= PRICE_MIN) {
      found.push({
        id: `price-increase:${latest.id}`,
        kind: "price-increase",
        date: latest.date,
        title: `Price went up: ${payeeName(latest)}`,
        detail: `${shekels(amount)} this time; it was ${shekels(usual)} a month before.`,
        amount: amount - usual,
        transactionIds: [latest.id],
      });
    }
  }
  return found;
}
