import type { RunSummary } from "@/api/client";
import type { LogEntry } from "@/components/ScrapeLogs";

const CARD_COMPANIES = new Set(["max", "visaCal", "isracard", "amex", "beyahadBishvilha", "behatsdaa"]);

export function accountKind(companyId: string): "Card" | "Bank" {
  return CARD_COMPANIES.has(companyId) ? "Card" : "Bank";
}

export interface AccountUpdate {
  lastSuccess?: string;
  /** Only when the newest try of this account failed. */
  lastFailure?: { at: string; error: string };
}

/** Per account, from past runs (newest first): the last successful update and a current failure. */
export function lastUpdates(runs: RunSummary[]): Record<string, AccountUpdate> {
  const result: Record<string, AccountUpdate> = {};
  for (const run of runs) {
    for (const a of run.accounts) {
      const seen = a.accountName in result;
      const entry = (result[a.accountName] ??= {});
      if (a.success) entry.lastSuccess ??= run.createdAt;
      else if (!seen) entry.lastFailure = { at: run.createdAt, error: a.error ?? "Failed" };
    }
  }
  return result;
}

/** The scrape starts 3 days before the oldest last success of the selected accounts (yyyy-mm-dd). */
export function fromDate(updates: Record<string, AccountUpdate>, selected: string[]): string | null {
  const dates = selected.map((name) => updates[name]?.lastSuccess);
  if (!dates.length || dates.some((d) => !d)) return null;
  const oldest = dates.reduce((min, d) => (d! < min! ? d : min))!.slice(0, 10);
  const [y, m, d] = oldest.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 3)).toISOString().slice(0, 10);
}

/** Whole days back from today (local) to a yyyy-mm-dd date; the scraper's `daysBack`. */
export function daysBackTo(date: string, now = new Date()): number {
  const [y, m, d] = date.split("-").map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.round((today.getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000));
}

/**
 * Library events, in the order the scraper sends them: START_SCRAPING and INITIALIZING (the
 * browser opens the site), LOGGING_IN (the login form was sent), LOGIN_SUCCESS (then it reads, with
 * no event), TERMINATING and END_SCRAPING. Then this repo logs "Found N … in account" and "Total".
 */
const EVENT_STEP: Record<string, string> = {
  START_SCRAPING: "Opening the bank site",
  INITIALIZING: "Opening the bank site",
  LOGGING_IN: "Logging in",
  LOGIN_SUCCESS: "Logged in · reading transactions",
  LOGIN_FAILED: "Login failed",
  CHANGE_PASSWORD: "The bank asks for a new password",
  TERMINATING: "Closing the bank site",
  END_SCRAPING: "Closing the bank site",
};

/** The live step of one account, from the scraper's progress messages. */
export function accountStep(entries: LogEntry[], name: string): string {
  let step = "Waiting";
  let found = 0;
  for (const e of entries) {
    if (e.account !== name) continue;
    const event = /\] ([A-Z_]+)\s*$/.exec(e.text)?.[1];
    const inAccount = /Found (\d+) transactions in account/.exec(e.text);
    const total = /Total: (\d+) transactions/.exec(e.text);
    if (total) step = `Found ${total[1]}`;
    else if (inAccount) step = `Found ${(found += Number(inAccount[1]))} so far`;
    else if (event && EVENT_STEP[event]) step = EVENT_STEP[event];
    else if (/Retrying/.test(e.text)) step = "Temporary error · trying again";
    else if (/^\s*Scraping /.test(e.text)) step = "Starting";
  }
  return step;
}

/** The newest log line of one account, shown under its step. */
export function lastLine(entries: LogEntry[], name: string): string {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].account === name && entries[i].text.trim()) return entries[i].text.trim();
  return "";
}
