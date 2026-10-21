import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw } from "lucide-react";
import { getAccounts } from "@/api/client";
import { STORAGE_KEYS, readStoredJson, useScrapeRun } from "@/lib/scrape-run";
import { useSpending } from "@/lib/spending";
import { chipView, savedRunParams, type ChipView, type SavedScrapeOptions } from "@/lib/update-chip";
import { cn } from "@/lib/utils";

const TONE: Record<ChipView["tone"], string> = {
  muted: "bg-muted text-muted-foreground",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  running: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  success: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200",
  danger: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200",
};

const ICON: Record<ChipView["tone"], typeof RefreshCw> = {
  muted: RefreshCw,
  warning: RefreshCw,
  running: Loader2,
  success: Check,
  danger: AlertTriangle,
};

/** Time since the last update; a tap runs a scrape with the Scrape tab's saved options. */
export function UpdateChip({ openScrape }: { openScrape: () => void }) {
  const run = useScrapeRun();
  const { data, reload } = useSpending();
  const [ranHere, setRanHere] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  if (run.phase === "progress" && !ranHere) setRanHere(true);

  // After a run (and its YNAB import, when that option is on), load the new numbers.
  useEffect(() => {
    if (run.phase === "progress") {
      running.current = true;
    } else if (running.current && run.phase === "results" && !run.ynabImporting) {
      running.current = false;
      reload({ fresh: true }); // the scrape (and its import) changed the data
    }
  }, [run.phase, run.ynabImporting, reload]);

  const view: ChipView = error
    ? { text: "Update failed", tone: "danger", opensScrape: true }
    : !data && run.phase !== "progress" && !ranHere
      ? { text: "Loading…", tone: "muted", opensScrape: true } // the last update time comes with the numbers
      : chipView({ phase: run.phase, accountStatuses: run.accountStatuses, error: run.error, ranHere, lastScrapedAt: data?.lastScrapedAt ?? null });
  const Icon = ICON[view.tone];

  const tap = async () => {
    if (view.opensScrape) {
      setError("");
      openScrape();
      return;
    }
    try {
      const enabled = (await getAccounts()).filter((a) => a.enabled).map((a) => a.name);
      run.start(savedRunParams(readStoredJson<SavedScrapeOptions>(STORAGE_KEYS.settings, {}), enabled, data?.lastScrapedAt ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the update");
    }
  };

  return (
    <button
      type="button"
      onClick={() => void tap()}
      title={error || undefined}
      className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium", TONE[view.tone])}
    >
      <Icon className={cn("h-3.5 w-3.5", view.tone === "running" && "animate-spin")} aria-hidden="true" />
      {view.text}
    </button>
  );
}
