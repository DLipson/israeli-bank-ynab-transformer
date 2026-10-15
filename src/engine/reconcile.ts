/**
 * Reconcile: compare what the bank/card reported (saved scrape runs) with what YNAB has, per account.
 * A bank row matches a YNAB transaction in the mapped account with the same amount and a date
 * within DATE_TOLERANCE days (the user may move a date). Leftovers on either side are discrepancies.
 * Only dates inside the scraped window count, minus the tolerance at the edges, so a row just
 * outside the window does not show as missing. Read-only. Amounts are signed milliunits.
 */
import type { YnabTransaction } from "../ynab/categorize.js";
import type { YnabRow } from "../transformer.js";
import { getRowSource } from "../ynab/import-service.js";

export const DATE_TOLERANCE = 3;
const DAY_MS = 86400000;

export interface ScrapeRun {
  createdAt: string;
  daysBack: number;
  rows: YnabRow[];
}

export interface BankRow {
  date: string;
  amount: number;
  payee: string;
}

export interface AccountReconcile {
  source: string;
  accountId: string;
  accountName: string;
  /** Dates checked (inclusive), after the edge tolerance. */
  from: string;
  to: string;
  matched: number;
  /** In the bank, not in YNAB. */
  missingInYnab: BankRow[];
  /** In YNAB, not in the bank. */
  missingInBank: YnabTransaction[];
  balance: BalanceCheck;
}

/**
 * The balance by the scrape alone: the YNAB balance at the last reconcile, plus every scraped row
 * since then that is not already in a reconciled transaction. `expected` is null when the scrapes
 * cannot give it; `note` says why.
 */
export interface BalanceCheck {
  /** Date of the newest reconciled transaction; null if the account was never reconciled. */
  reconciledDate: string | null;
  reconciledBalance: number;
  /** Sum of the scraped rows added on top of the reconciled balance. */
  scrapeTotal: number;
  scrapeRows: number;
  expected: number | null;
  /** All transactions in YNAB, cleared and uncleared. */
  ynabBalance: number;
  note?: string;
}

const shift = (date: string, days: number) => new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
const gap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;

function toBankRow(row: YnabRow): BankRow {
  const amount = Math.round(((parseFloat(row.inflow) || 0) - (parseFloat(row.outflow) || 0)) * 1000);
  return { date: row.date, amount, payee: row.payee };
}

/**
 * Join runs per source. Runs overlap, so a row counts as many times as the largest number of
 * times one run reported it. ponytail: the window is first start to last run; a gap between
 * runs shows as "missing in bank", fine while scrapes overlap.
 */
export function collectBankRows(runs: ScrapeRun[]): Map<string, { from: string; to: string; rows: BankRow[] }> {
  const out = new Map<string, { from: string; to: string; counts: Map<string, { row: BankRow; n: number }> }>();
  for (const run of runs) {
    const to = run.createdAt.slice(0, 10);
    const from = shift(to, -run.daysBack);
    const perRun = new Map<string, Map<string, { row: BankRow; n: number }>>();
    for (const r of run.rows) {
      const row = toBankRow(r);
      const counts = perRun.get(getRowSource(r)) ?? new Map();
      perRun.set(getRowSource(r), counts);
      // No payee in the key: the bank text changes between scraper versions ("ל.מאסטרקרד(יש)" → "ל.מאסטרקארד").
      const key = `${row.date}|${row.amount}`;
      counts.set(key, { row, n: (counts.get(key)?.n ?? 0) + 1 });
    }
    for (const [source, counts] of perRun) {
      const acc = out.get(source) ?? { from, to, counts: new Map() };
      out.set(source, acc);
      if (from < acc.from) acc.from = from;
      if (to > acc.to) acc.to = to;
      for (const [key, c] of counts) if (c.n > (acc.counts.get(key)?.n ?? 0)) acc.counts.set(key, c);
    }
  }
  return new Map(
    [...out].map(([source, a]) => [
      source,
      { from: a.from, to: a.to, rows: [...a.counts.values()].flatMap((c) => Array<BankRow>(c.n).fill(c.row)) },
    ])
  );
}

/** The card side of a transfer the user made from the bank: YNAB adds it, the card scrape never has it. */
const isMirror = (t: YnabTransaction) => !!t.transfer_account_id && !t.import_id;

const sum = (amounts: number[]) => amounts.reduce((s, a) => s + a, 0);

export function balanceSinceReconcile(
  bank: { from: string; to: string; rows: BankRow[] },
  inAccount: YnabTransaction[]
): BalanceCheck {
  const reconciled = inAccount.filter((t) => t.cleared === "reconciled");
  const reconciledDate = reconciled.reduce<string | null>((d, t) => (!d || t.date > d ? t.date : d), null);
  const reconciledBalance = sum(reconciled.map((t) => t.amount));
  const ynabBalance = sum(inAccount.map((t) => t.amount));
  const since = reconciledDate ? shift(reconciledDate, -DATE_TOLERANCE) : "";

  // Rows near the reconcile date may already be in it: drop those that match a reconciled transaction.
  const pool = new Set(reconciled.filter((t) => t.date >= shift(since, -DATE_TOLERANCE)));
  const added = bank.rows.filter((row) => {
    if (row.date < since) return false;
    const match = [...pool].find((t) => t.amount === row.amount && gap(t.date, row.date) <= DATE_TOLERANCE);
    if (match) pool.delete(match);
    return !match;
  });
  const scrapeTotal = sum(added.map((r) => r.amount));
  const result = { reconciledDate, reconciledBalance, scrapeTotal, scrapeRows: added.length, ynabBalance };

  if (!reconciledDate) return { ...result, expected: null, note: "Never reconciled in YNAB." };
  if (bank.from > reconciledDate) {
    const days = Math.ceil(gap(reconciledDate, bank.to)) + DATE_TOLERANCE;
    return {
      ...result,
      expected: null,
      note: `The saved scrapes start ${bank.from}, after the last reconcile on ${reconciledDate}. Scrape this account with ${days} days back.`,
    };
  }
  if (inAccount.some((t) => isMirror(t) && t.date > reconciledDate)) {
    return { ...result, expected: null, note: "Payments to this card come from the bank, so the card scrape does not have them." };
  }
  return { ...result, expected: reconciledBalance + scrapeTotal };
}

export function reconcile(
  runs: ScrapeRun[],
  ynab: YnabTransaction[],
  mappings: Record<string, string>
): AccountReconcile[] {
  const results: AccountReconcile[] = [];
  for (const [source, bank] of collectBankRows(runs)) {
    const accountId = mappings[source];
    if (!accountId) continue;
    const from = shift(bank.from, DATE_TOLERANCE);
    const to = shift(bank.to, -DATE_TOLERANCE);
    const inAccount = ynab.filter((t) => t.account_id === accountId && !t.deleted);
    const unmatched = new Set(inAccount);
    const missingInYnab: BankRow[] = [];
    let matched = 0;

    // Closest date first, so a pair of equal charges on near dates match the right way round.
    for (const row of [...bank.rows].sort((a, b) => a.date.localeCompare(b.date))) {
      let best: YnabTransaction | undefined;
      for (const t of unmatched) {
        if (t.amount !== row.amount || gap(t.date, row.date) > DATE_TOLERANCE) continue;
        if (!best || gap(t.date, row.date) < gap(best.date, row.date)) best = t;
      }
      if (best) {
        unmatched.delete(best);
        matched += 1;
      } else if (row.date >= from && row.date <= to) missingInYnab.push(row);
    }

    const missingInBank = [...unmatched]
      .filter((t) => t.date >= from && t.date <= to && !isMirror(t))
      .sort((a, b) => a.date.localeCompare(b.date));
    const accountName = inAccount[0]?.account_name ?? accountId;
    const balance = balanceSinceReconcile(bank, inAccount);
    results.push({ source, accountId, accountName, from, to, matched, missingInYnab, missingInBank, balance });
  }
  return results;
}
