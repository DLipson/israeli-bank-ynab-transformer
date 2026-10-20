import { useState, useEffect, useRef } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrapeLogs } from "@/components/ScrapeLogs";
import { ScrapeSummary } from "@/components/ScrapeSummary";
import { TransactionTable } from "@/components/TransactionTable";
import { SkippedList } from "@/components/SkippedList";
import { exportCSV, openPath, getAccounts, getRuns, type AccountInfo, type RunSummary } from "@/api/client";
import { useScrapeRun, STORAGE_KEYS, readStoredJson, writeStoredJson, removeStored, type ExportResult, type CopyStatus } from "@/lib/scrape-run";
import { accountKind, accountStep, daysBackTo, fromDate, lastUpdates } from "@/lib/scrape-view";
import { formatDate } from "@/lib/spending";
import { card, label, link, row } from "@/lib/rows";
import { cn } from "@/lib/utils";

type StoredSettings = {
  daysBack: number;
  outputDir: string;
  split: boolean;
  showBrowser: boolean;
  autoYnabImport: boolean;
  enableDetailedLogging: boolean;
  detailedLoggingLimit: number;
  concurrency: number;
  selectedAccounts: string[];
};

function formatTimestamp(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

const ago = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

function OptionSwitch({ id, text, checked, onChange }: { id: string; text: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={row}>
      <Label htmlFor={id} className="font-normal">
        {text}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function ScrapePage({ openInbox, openHistory }: { openInbox?: () => void; openHistory?: () => void }) {
  const { phase, accountStatuses, entries, payload, error, ynabResult, ynabImporting, start, cancel, setError, importRows } = useScrapeRun();

  const [initialSettings] = useState(() => readStoredJson<Partial<StoredSettings>>(STORAGE_KEYS.settings, {}));
  const [daysBack] = useState(() => initialSettings.daysBack ?? 60);
  const [outputDir, setOutputDir] = useState(() => `./output/${formatTimestamp()}`);
  const [split, setSplit] = useState(() => initialSettings.split ?? false);
  const [showBrowser, setShowBrowser] = useState(() => initialSettings.showBrowser ?? false);
  const [autoYnabImport, setAutoYnabImport] = useState(() => initialSettings.autoYnabImport ?? false);
  const [enableDetailedLogging, setEnableDetailedLogging] = useState(() => initialSettings.enableDetailedLogging ?? false);
  const [detailedLoggingLimit, setDetailedLoggingLimit] = useState(() => initialSettings.detailedLoggingLimit ?? 10);
  const [concurrency, setConcurrency] = useState(() => initialSettings.concurrency ?? 1);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(() => initialSettings.selectedAccounts ?? []);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [pickedFrom, setPickedFrom] = useState<string | null>(null);
  const [changingFrom, setChangingFrom] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [shown, setShown] = useState<"" | "tx" | "log">("");
  const [openRun, setOpenRun] = useState("");

  const [exportResult, setExportResult] = useState<ExportResult | null>(() => readStoredJson<ExportResult | null>(STORAGE_KEYS.exportResult, null));
  const [exporting, setExporting] = useState(false);
  const [openingOutput, setOpeningOutput] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  useEffect(() => {
    getAccounts()
      .then(setAccounts)
      .catch((e) => setAccountsError(e instanceof Error ? e.message : "Failed to load accounts"))
      .finally(() => setAccountsLoading(false));
  }, []);

  // Past runs: on open and after each run, for the last-update column and the list below.
  useEffect(() => {
    if (phase === "progress") return;
    getRuns()
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [phase]);

  useEffect(() => {
    writeStoredJson(STORAGE_KEYS.settings, {
      daysBack,
      outputDir,
      split,
      showBrowser,
      autoYnabImport,
      enableDetailedLogging,
      detailedLoggingLimit,
      concurrency,
      selectedAccounts,
    });
  }, [daysBack, outputDir, split, showBrowser, autoYnabImport, enableDetailedLogging, detailedLoggingLimit, concurrency, selectedAccounts]);

  useEffect(() => {
    if (exportResult) writeStoredJson(STORAGE_KEYS.exportResult, exportResult);
    else removeStored(STORAGE_KEYS.exportResult);
  }, [exportResult]);

  // First load: keep the saved selection that is still enabled; none saved = all enabled accounts.
  const selectionInitialized = useRef(false);
  useEffect(() => {
    if (accountsLoading || accountsError || selectionInitialized.current) return;
    const enabledNames = accounts.filter((a) => a.enabled).map((a) => a.name);
    if (enabledNames.length === 0) return;
    selectionInitialized.current = true;
    const valid = selectedAccounts.filter((name) => enabledNames.includes(name));
    if (valid.length !== selectedAccounts.length || valid.length === 0) setSelectedAccounts(valid.length ? valid : enabledNames);
  }, [accounts, accountsError, accountsLoading, selectedAccounts]);

  const enabled = accounts.filter((a) => a.enabled);
  const updates = lastUpdates(runs);
  const autoFrom = fromDate(updates, selectedAccounts);
  const from = pickedFrom ?? autoFrom;
  const running = phase === "progress";
  const statusOf = (name: string) => accountStatuses.find((a) => a.name === name);

  const run = (names: string[]) => {
    setExportResult(null);
    setShown("");
    start({
      daysBack: from ? daysBackTo(from) : daysBack,
      showBrowser,
      enableDetailedLogging,
      detailedLoggingLimit,
      concurrency,
      selectedAccounts: names,
      autoYnabImport,
    });
  };

  const toggle = (name: string) =>
    setSelectedAccounts(selectedAccounts.includes(name) ? selectedAccounts.filter((a) => a !== name) : [...selectedAccounts, name]);

  const handleExport = async () => {
    if (!payload) return;
    setExporting(true);
    setError("");
    try {
      setExportResult(await exportCSV({ rows: payload.rows, outputDir, split, auditLog: payload.auditLog, runId: payload.runId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleCopyLogs = async () => {
    if (entries.length === 0) return;
    try {
      await navigator.clipboard.writeText(entries.map((e) => e.text).join("\n"));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    } finally {
      window.setTimeout(() => setCopyStatus("idle"), 2000);
    }
  };

  const handleOpenOutput = async () => {
    setOpeningOutput(true);
    setError("");
    try {
      await openPath(outputDir);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open output folder");
    } finally {
      setOpeningOutput(false);
    }
  };

  const rightSide = (a: AccountInfo) => {
    const status = statusOf(a.name);
    if (status?.status === "failed") {
      return (
        <span className="flex items-center gap-2 text-[13px]">
          <span className="text-red-700 dark:text-red-400">{status.error ?? "Failed"}</span>
          {!running && (
            <button type="button" className={link} onClick={() => run([a.name])}>
              Retry
            </button>
          )}
        </span>
      );
    }
    if (status && (running || phase === "results")) {
      if (status.status === "done") {
        const step = ynabImporting ? "Sending to YNAB" : `Done · ${status.transactionCount ?? 0} found`;
        return (
          <span className={cn("flex items-center gap-1 text-[13px]", ynabImporting ? "text-sky-700 dark:text-sky-400" : "text-green-700 dark:text-green-400")}>
            {ynabImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {step}
          </span>
        );
      }
      if (running) {
        const step = status.status === "pending" ? "Waiting" : accountStep(entries, a.name);
        return (
          <span className={cn("flex items-center gap-1 text-[13px]", step === "Waiting" ? "text-muted-foreground" : "text-sky-700 dark:text-sky-400")}>
            {step !== "Waiting" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {step}
          </span>
        );
      }
    }
    const u = updates[a.name];
    return (
      <span className="text-right text-[13px] text-muted-foreground">
        {u?.lastSuccess ? `Updated ${formatDate(u.lastSuccess.slice(0, 10))} · ${ago(u.lastSuccess)} days` : "Never updated"}
        {u?.lastFailure && <span className="block text-red-700 dark:text-red-400">Last try failed: {u.lastFailure.error}</span>}
      </span>
    );
  };

  const failedNames = accountStatuses.filter((a) => a.status === "failed").map((a) => a.name);

  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className={label}>Accounts</p>
          <span className={label}>
            {changingFrom ? (
              <Input
                type="date"
                aria-label="Scrape from"
                className="h-7 w-40"
                value={from ?? ""}
                onChange={(e) => setPickedFrom(e.target.value || null)}
                onBlur={() => setChangingFrom(false)}
              />
            ) : (
              <>
                {from ? (
                  <>
                    From {formatDate(from)} <span className="text-xs">{pickedFrom ? "(your date)" : "(last update − 3 days)"}</span>
                  </>
                ) : (
                  `${daysBack} days back`
                )}{" "}
                <button type="button" className={link} onClick={() => setChangingFrom(true)}>
                  Change
                </button>
              </>
            )}
          </span>
        </div>

        {accountsLoading && <p className="py-1.5 text-xs text-muted-foreground">Loading accounts…</p>}
        {accountsError && <p className="py-1.5 text-xs text-destructive">{accountsError}</p>}
        {!accountsLoading && !accountsError && enabled.length === 0 && (
          <p className="py-1.5 text-xs text-muted-foreground">No configured accounts. Add logins in Settings → Bank accounts.</p>
        )}
        {enabled.map((a) => (
          <div key={a.name} className={row}>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={selectedAccounts.includes(a.name)} disabled={running} onChange={() => toggle(a.name)} />
              {a.name} <span className="text-xs text-muted-foreground">{accountKind(a.companyId)}</span>
            </label>
            {rightSide(a)}
          </div>
        ))}

        <div className="mt-3 flex items-center gap-2">
          {running ? (
            <>
              <Button disabled className="flex-1">
                <Loader2 className="h-4 w-4 animate-spin" /> Updating…
              </Button>
              <Button variant="outline" onClick={() => void cancel()}>
                Cancel
              </Button>
            </>
          ) : (
            <Button className="flex-1" disabled={selectedAccounts.length === 0} onClick={() => run(selectedAccounts)}>
              <RefreshCw className="h-4 w-4" /> Update {selectedAccounts.length} account{selectedAccounts.length === 1 ? "" : "s"}
            </Button>
          )}
          <button type="button" className={link} onClick={() => setShowOptions((s) => !s)} aria-expanded={showOptions}>
            {showOptions ? "Hide" : "Options"}
          </button>
        </div>

        {showOptions && (
          <div className="mt-2.5">
            <OptionSwitch id="autoYnabImport" text="Send to YNAB after scrape" checked={autoYnabImport} onChange={setAutoYnabImport} />
            <OptionSwitch id="showBrowser" text="Show browser window" checked={showBrowser} onChange={setShowBrowser} />
            <OptionSwitch id="split" text="Split CSV by account" checked={split} onChange={setSplit} />
            <OptionSwitch id="enableDetailedLogging" text="Detailed logging" checked={enableDetailedLogging} onChange={setEnableDetailedLogging} />
            {enableDetailedLogging && (
              <div className={row}>
                <Label htmlFor="detailedLoggingLimit" className="font-normal text-muted-foreground">
                  Log item limit (0 = all items)
                </Label>
                <Input id="detailedLoggingLimit" type="number" min={0} value={detailedLoggingLimit} onChange={(e) => setDetailedLoggingLimit(parseInt(e.target.value) || 0)} className="h-7 w-20" />
              </div>
            )}
            <div className={row}>
              <Label htmlFor="concurrency" className="font-normal">
                Accounts at the same time
              </Label>
              <Input id="concurrency" type="number" min={1} max={5} value={concurrency} onChange={(e) => setConcurrency(Math.max(1, parseInt(e.target.value) || 1))} className="h-7 w-20" />
            </div>
            <div className={row}>
              <Label htmlFor="outputDir" className="font-normal">
                Output folder
              </Label>
              <Input id="outputDir" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} className="h-7 w-64" />
            </div>
          </div>
        )}
      </div>

      {phase === "results" && (error || payload) && (
        <div className={card}>
          {payload && (
            <p className="mb-1 font-medium">
              {payload.rows.length} new transaction{payload.rows.length === 1 ? "" : "s"}
              {ynabResult && ` · ${ynabResult.imported} sent to YNAB · ${ynabResult.duplicates} already there`}
            </p>
          )}
          <p className={cn(label, error && "text-destructive")}>
            {error || (failedNames.length ? `${failedNames.join(", ")} failed. Retry it above.` : "All accounts updated.")}
          </p>
          {ynabResult && ynabResult.unmapped.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Not mapped (map them in Settings → YNAB import): {ynabResult.unmapped.join(", ")}</p>}
          {payload && (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {openInbox && (
                  <Button variant="outline" onClick={openInbox}>
                    Categorize in Inbox
                  </Button>
                )}
                {!ynabResult && (
                  <Button variant="outline" onClick={() => void importRows(payload.rows, payload.runId)} disabled={ynabImporting}>
                    {ynabImporting ? "Sending…" : "Send to YNAB"}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setShown(shown === "tx" ? "" : "tx")} aria-expanded={shown === "tx"}>
                  See transactions
                </Button>
                <Button variant="outline" onClick={() => setShown(shown === "log" ? "" : "log")} aria-expanded={shown === "log"}>
                  Log and CSV
                </Button>
              </div>
              {shown === "tx" && (
                <div className="mt-3 space-y-3">
                  <ScrapeSummary summary={payload.summary} />
                  <TransactionTable rows={payload.rows} />
                  <SkippedList skipped={payload.skipped} />
                </div>
              )}
              {shown === "log" && (
                <div className="mt-3 space-y-2">
                  {entries.length > 0 && <ScrapeLogs entries={entries} />}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={handleCopyLogs} disabled={entries.length === 0 || copyStatus === "copied"}>
                      {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : "Copy log"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                      {exporting ? "Exporting…" : "Export CSV"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleOpenOutput} disabled={openingOutput}>
                      {openingOutput ? "Opening…" : "Open output folder"}
                    </Button>
                  </div>
                  {exportResult && (
                    <ul className="text-xs text-muted-foreground">
                      {exportResult.csvPaths.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                      <li>Audit log: {exportResult.auditLogPath}</li>
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className={card}>
        <div className="mb-1.5 flex items-center justify-between">
          <p className={label}>Past updates</p>
          {openHistory && (
            <button type="button" className={link} onClick={openHistory}>
              All runs and details
            </button>
          )}
        </div>
        {runs.length === 0 && <p className="border-t py-1.5 text-sm text-muted-foreground">No updates yet.</p>}
        {runs.slice(0, 8).map((r) => {
          const Chevron = openRun === r.id ? ChevronDown : ChevronRight;
          return (
            <div key={r.id}>
              <button type="button" className={cn(row, "w-full text-left hover:bg-muted/50")} onClick={() => setOpenRun(openRun === r.id ? "" : r.id)} aria-expanded={openRun === r.id}>
                <span className="flex items-center gap-1">
                  <Chevron className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {formatDate(r.createdAt.slice(0, 10))}
                  <span className="ml-1 tracking-widest text-muted-foreground">{r.accounts.map((a) => (a.success ? "✓" : "✗")).join("")}</span>
                </span>
                <span>{r.rowCount} new</span>
              </button>
              {openRun === r.id && (
                <div className="mb-1 pl-4">
                  {r.accounts.map((a) => (
                    <div key={a.accountName} className={row}>
                      <span className="text-muted-foreground">{a.accountName}</span>
                      <span className={cn(!a.success && "text-red-700 dark:text-red-400")}>{a.success ? `OK · ${a.transactionCount}` : `Failed: ${a.error ?? "unknown"}`}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
