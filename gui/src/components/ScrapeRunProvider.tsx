import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createScrapeStream,
  cancelScrape,
  importToYnab,
  type SSEEvent,
  type ScrapePayload,
  type YnabImportResult,
  type YnabRow,
} from "@/api/client";
import {
  ScrapeRunContext,
  STORAGE_KEYS,
  extractLastScrapeAt,
  readStoredJson,
  removeStored,
  writeStoredJson,
  type AccountStatus,
  type Phase,
  type ScrapeRunParams,
  type ScrapeRunState,
} from "@/lib/scrape-run";
import type { LogEntry } from "@/components/ScrapeLogs";

/** The log keeps the last 5,000 lines, so a very long run does not grow memory without limit. */
const MAX_ENTRIES = 5000;

/** Holds the live run above the tabs, so leaving the view does not stop the stream. */
export function ScrapeRunProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(() =>
    readStoredJson<ScrapePayload | null>(STORAGE_KEYS.payload, null) ? "results" : "settings"
  );
  const [accountStatuses, setAccountStatuses] = useState<AccountStatus[]>([]);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [payload, setPayload] = useState<ScrapePayload | null>(() =>
    readStoredJson<ScrapePayload | null>(STORAGE_KEYS.payload, null)
  );
  const [lastScrapeAt, setLastScrapeAt] = useState<string | null>(() => {
    const storedPayload = readStoredJson<ScrapePayload | null>(STORAGE_KEYS.payload, null);
    return readStoredJson<string | null>(STORAGE_KEYS.lastScrapeAt, null) ?? extractLastScrapeAt(storedPayload);
  });
  const [error, setError] = useState("");
  const [ynabResult, setYnabResult] = useState<YnabImportResult | null>(null);
  const [ynabImporting, setYnabImporting] = useState(false);
  const streamRef = useRef<EventSource | null>(null);
  const scrapeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (payload) {
      writeStoredJson(STORAGE_KEYS.payload, payload);
    } else {
      removeStored(STORAGE_KEYS.payload);
    }
  }, [payload]);

  useEffect(() => {
    if (lastScrapeAt) {
      writeStoredJson(STORAGE_KEYS.lastScrapeAt, lastScrapeAt);
    } else {
      removeStored(STORAGE_KEYS.lastScrapeAt);
    }
  }, [lastScrapeAt]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.close();
        streamRef.current = null;
      }
      scrapeIdRef.current = null;
    };
  }, []);

  const doImport = useCallback(async (rows: YnabRow[], runId?: string) => {
    setYnabImporting(true);
    setError("");
    try {
      setYnabResult(await importToYnab(rows, runId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "YNAB import failed");
    } finally {
      setYnabImporting(false);
    }
  }, []);

  const importRows = useCallback(
    (rows?: YnabRow[], runId?: string) => {
      const target = rows ?? payload?.rows;
      return target ? doImport(target, runId) : Promise.resolve();
    },
    [payload, doImport]
  );

  const start = useCallback(
    (params: ScrapeRunParams) => {
      if (params.selectedAccounts.length === 0) {
        setError("Select at least one account to scrape.");
        setPhase("results");
        return;
      }

      setPhase("progress");
      setAccountStatuses(
        params.selectedAccounts.map((name) => ({ name, status: "pending" as const }))
      );
      setEntries([]);
      setPayload(null);
      setYnabResult(null);
      setError("");

      const scrapeId = crypto.randomUUID();
      scrapeIdRef.current = scrapeId;

      const stream = createScrapeStream(
        params.daysBack,
        params.showBrowser,
        params.enableDetailedLogging,
        params.detailedLoggingLimit,
        params.concurrency,
        params.selectedAccounts,
        scrapeId,
        (event: SSEEvent) => {
          switch (event.type) {
            case "warning":
              setEntries((prev) => [...prev, { text: `Warning: ${event.message}` }].slice(-MAX_ENTRIES));
              break;

            case "progress":
              setEntries((prev) => [...prev, { text: event.message ?? "", account: event.account }].slice(-MAX_ENTRIES));
              if (event.message) {
                // The server sends "\nScraping <name>...", with a leading newline.
                const match = event.message.match(/^\s*Scraping (.+)\.\.\.$/);
                if (match) {
                  const name = match[1];
                  setAccountStatuses((prev) => {
                    const exists = prev.find((a) => a.name === name);
                    if (exists) {
                      return prev.map((a) =>
                        a.name === name ? { ...a, status: "scraping" as const } : a
                      );
                    }
                    return [...prev, { name, status: "scraping" as const }];
                  });
                }
              }
              break;

            case "account-done":
              setAccountStatuses((prev) => {
                const name = event.accountName ?? "";
                const exists = prev.find((a) => a.name === name);
                const entry: AccountStatus = {
                  name,
                  status: event.success ? "done" : "failed",
                  transactionCount: event.transactionCount,
                  error: event.error,
                };
                if (exists) {
                  return prev.map((a) => (a.name === name ? entry : a));
                }
                return [...prev, entry];
              });
              break;

            case "done":
              if (event.payload) {
                setPayload(event.payload);
                const next = extractLastScrapeAt(event.payload);
                if (next) {
                  setLastScrapeAt(next);
                }
                if (params.autoYnabImport) {
                  void doImport(event.payload.rows, event.payload.runId);
                }
              }
              setPhase("results");
              break;

            case "error":
              setError(event.message ?? "Unknown error");
              setPhase("results");
              break;
          }
        }
      );
      streamRef.current = stream;
    },
    [doImport]
  );

  const cancel = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
    if (scrapeIdRef.current) {
      try {
        await cancelScrape(scrapeIdRef.current);
      } catch {
        // ignore cancel errors
      }
    }
    scrapeIdRef.current = null;
    setError("Scrape canceled.");
    setPhase("results");
  }, []);

  const reset = useCallback(() => {
    setPhase("settings");
    setPayload(null);
    setYnabResult(null);
    setError("");
  }, []);

  const value: ScrapeRunState = useMemo(
    () => ({
      phase,
      accountStatuses,
      entries,
      payload,
      lastScrapeAt,
      error,
      ynabResult,
      ynabImporting,
      start,
      cancel,
      reset,
      setError,
      importRows,
    }),
    [phase, accountStatuses, entries, payload, lastScrapeAt, error, ynabResult, ynabImporting, start, cancel, reset, importRows]
  );

  return <ScrapeRunContext.Provider value={value}>{children}</ScrapeRunContext.Provider>;
}
