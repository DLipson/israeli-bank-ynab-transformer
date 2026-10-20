import type { AccountStatus } from "@/components/ScrapeProgress";
import { MS_PER_DAY, startOfDay, type Phase, type ScrapeRunParams } from "@/lib/scrape-run";

/** The Scrape page's saved options (localStorage `scrape.settings.v1`). */
export type SavedScrapeOptions = Partial<ScrapeRunParams>;

/** The scrape starts this many days before the last successful update, so nothing is missed. */
const OVERLAP_DAYS = 3;
const OLD_AFTER_DAYS = 3;

/** Days back from today to the last update − 3 days, counted in whole local days. */
export function daysBackFrom(lastAt: string, now = new Date()): number {
  const from = startOfDay(new Date(lastAt));
  from.setDate(from.getDate() - OVERLAP_DAYS);
  return Math.max(1, Math.round((startOfDay(now).getTime() - from.getTime()) / MS_PER_DAY));
}

/** Run parameters for the update chip: the saved options, with only accounts that are still enabled. */
export function savedRunParams(
  saved: SavedScrapeOptions,
  enabledAccounts: string[],
  lastScrapedAt: string | null,
  now = new Date()
): ScrapeRunParams {
  const selected = (saved.selectedAccounts ?? []).filter((name) => enabledAccounts.includes(name));
  return {
    daysBack: lastScrapedAt ? daysBackFrom(lastScrapedAt, now) : (saved.daysBack ?? 60),
    showBrowser: saved.showBrowser ?? false,
    enableDetailedLogging: saved.enableDetailedLogging ?? false,
    detailedLoggingLimit: saved.detailedLoggingLimit ?? 10,
    concurrency: saved.concurrency ?? 1,
    selectedAccounts: selected.length ? selected : enabledAccounts,
    autoYnabImport: saved.autoYnabImport ?? false,
  };
}

export interface ChipView {
  text: string;
  tone: "muted" | "warning" | "running" | "success" | "danger";
  /** True: a tap opens the Scrape tab. False: a tap starts an update. */
  opensScrape: boolean;
}

function age(lastAt: string, now: Date): { text: string; days: number } {
  const ms = now.getTime() - new Date(lastAt).getTime();
  const days = Math.floor(ms / MS_PER_DAY);
  if (days >= 1) return { text: `${days} day${days === 1 ? "" : "s"} ago`, days };
  const hours = Math.floor(ms / 3_600_000);
  return { text: hours >= 1 ? `${hours} hour${hours === 1 ? "" : "s"} ago` : "just now", days };
}

export function chipView(input: {
  phase: Phase;
  accountStatuses: AccountStatus[];
  error: string;
  /** A run started while this page was open: show its result instead of the data age. */
  ranHere: boolean;
  lastScrapedAt: string | null;
  now?: Date;
}): ChipView {
  const { phase, accountStatuses, error, ranHere, lastScrapedAt, now = new Date() } = input;
  if (phase === "progress") {
    const finished = accountStatuses.filter((a) => a.status === "done" || a.status === "failed").length;
    return { text: `Updating ${finished} of ${accountStatuses.length}`, tone: "running", opensScrape: true };
  }
  if (ranHere && phase === "results") {
    const failed = accountStatuses.filter((a) => a.status === "failed").map((a) => a.name);
    if (failed.length) return { text: `${failed.join(", ")} failed`, tone: "danger", opensScrape: true };
    if (error) return { text: "Update failed", tone: "danger", opensScrape: true };
    return { text: "Updated just now", tone: "success", opensScrape: true };
  }
  if (!lastScrapedAt) return { text: "Never updated", tone: "warning", opensScrape: false };
  const { text, days } = age(lastScrapedAt, now);
  return { text: `Updated ${text}`, tone: days >= OLD_AFTER_DAYS ? "warning" : "muted", opensScrape: false };
}
