import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrapeSettings } from "@/components/ScrapeSettings";
import { ScrapeProgress } from "@/components/ScrapeProgress";
import { ScrapeLogs } from "@/components/ScrapeLogs";
import { ScrapeSummary } from "@/components/ScrapeSummary";
import { TransactionTable } from "@/components/TransactionTable";
import { SkippedList } from "@/components/SkippedList";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { exportCSV, openPath, getAccounts, type AccountInfo } from "@/api/client";
import {
  useScrapeRun,
  STORAGE_KEYS,
  readStoredJson,
  writeStoredJson,
  removeStored,
  calculateDaysBack,
  parseDate,
  type ExportResult,
  type CopyStatus,
} from "@/lib/scrape-run";

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

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimestamp(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

export function ScrapePage() {
  const {
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
  } = useScrapeRun();

  const [initialSettings] = useState(() =>
    readStoredJson<Partial<StoredSettings>>(STORAGE_KEYS.settings, {})
  );

  const [daysBack, setDaysBack] = useState(() => initialSettings.daysBack ?? 60);
  const [outputDir, setOutputDir] = useState(() => `./output/${formatTimestamp()}`);
  const [split, setSplit] = useState(() => initialSettings.split ?? false);
  const [showBrowser, setShowBrowser] = useState(() => initialSettings.showBrowser ?? false);
  const [autoYnabImport, setAutoYnabImport] = useState(() => initialSettings.autoYnabImport ?? false);
  const [enableDetailedLogging, setEnableDetailedLogging] = useState(
    () => initialSettings.enableDetailedLogging ?? false
  );
  const [detailedLoggingLimit, setDetailedLoggingLimit] = useState(
    () => initialSettings.detailedLoggingLimit ?? 10
  );
  const [concurrency, setConcurrency] = useState(() => initialSettings.concurrency ?? 1);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(
    () => initialSettings.selectedAccounts ?? []
  );

  const [exportResult, setExportResult] = useState<ExportResult | null>(() =>
    readStoredJson<ExportResult | null>(STORAGE_KEYS.exportResult, null)
  );
  const [exporting, setExporting] = useState(false);
  const [openingOutput, setOpeningOutput] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [logsCollapsed, setLogsCollapsed] = useState(false);

  const lastScrapeDate = parseDate(lastScrapeAt);

  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        setAccountsError("");
        const data = await getAccounts();
        setAccounts(data);
      } catch (e) {
        setAccountsError(e instanceof Error ? e.message : "Failed to load accounts");
      } finally {
        setAccountsLoading(false);
      }
    };

    fetchAccounts();
  }, []);

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
  }, [
    daysBack,
    outputDir,
    split,
    showBrowser,
    autoYnabImport,
    enableDetailedLogging,
    detailedLoggingLimit,
    concurrency,
    selectedAccounts,
  ]);

  useEffect(() => {
    if (exportResult) {
      writeStoredJson(STORAGE_KEYS.exportResult, exportResult);
    } else {
      removeStored(STORAGE_KEYS.exportResult);
    }
  }, [exportResult]);

  const selectionInitializedRef = useRef(false);

  useEffect(() => {
    if (accountsLoading) return;
    if (accountsError) return;
    const enabledNames = accounts.filter((account) => account.enabled).map((account) => account.name);
    if (enabledNames.length === 0) return;
    if (selectionInitializedRef.current) return;
    selectionInitializedRef.current = true;
    const validSelected = selectedAccounts.filter((name) => enabledNames.includes(name));
    if (validSelected.length === 0) {
      setSelectedAccounts(enabledNames);
    } else if (validSelected.length !== selectedAccounts.length) {
      setSelectedAccounts(validSelected);
    }
  }, [accounts, accountsError, accountsLoading, selectedAccounts]);

  const handleStart = () => {
    start({
      daysBack,
      showBrowser,
      enableDetailedLogging,
      detailedLoggingLimit,
      concurrency,
      selectedAccounts,
      autoYnabImport,
    });
  };

  const handleExport = async () => {
    if (!payload) return;
    setExporting(true);
    setError("");
    try {
      const result = await exportCSV({
        rows: payload.rows,
        outputDir,
        split,
        auditLog: payload.auditLog,
        runId: payload.runId,
      });
      setExportResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleReset = () => {
    const nextDaysBack = calculateDaysBack(lastScrapeAt);
    if (nextDaysBack) {
      setDaysBack(nextDaysBack);
    }
    setExportResult(null);
    setCopyStatus("idle");
    reset();
  };

  const handleBack = () => {
    reset();
  };

  const handleCopyLogs = async () => {
    if (entries.length === 0) return;
    const text = entries.map((e) => e.text).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    } finally {
      window.setTimeout(() => setCopyStatus("idle"), 2000);
    }
  };

  const handleOpenOutput = async () => {
    if (!outputDir) return;
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

  return (
    <div className="space-y-4">
      {phase === "settings" && (
        <Card>
          <CardHeader>
            <CardTitle>Scrape Settings</CardTitle>
            {lastScrapeDate && (
              <p className="text-xs text-muted-foreground">
                Last scraped: {formatLocalDate(lastScrapeDate)}
              </p>
            )}
          </CardHeader>
          <CardContent>
            <ScrapeSettings
              daysBack={daysBack}
              setDaysBack={setDaysBack}
              outputDir={outputDir}
              setOutputDir={setOutputDir}
              split={split}
              setSplit={setSplit}
              showBrowser={showBrowser}
              setShowBrowser={setShowBrowser}
              autoYnabImport={autoYnabImport}
              setAutoYnabImport={setAutoYnabImport}
              enableDetailedLogging={enableDetailedLogging}
              setEnableDetailedLogging={setEnableDetailedLogging}
              detailedLoggingLimit={detailedLoggingLimit}
              setDetailedLoggingLimit={setDetailedLoggingLimit}
              concurrency={concurrency}
              setConcurrency={setConcurrency}
              accounts={accounts}
              selectedAccounts={selectedAccounts}
              setSelectedAccounts={setSelectedAccounts}
              accountsLoading={accountsLoading}
              accountsError={accountsError}
              onStart={handleStart}
            />
          </CardContent>
        </Card>
      )}

      {phase === "progress" && (
        <Card>
          <CardHeader>
            <CardTitle>Scraping in progress...</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrapeProgress accounts={accountStatuses} entries={entries} />
            <div className="mt-4">
              <Button variant="outline" onClick={() => void cancel()}>
                Cancel Scrape
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {phase === "results" && (
        <div className="space-y-4">
          {error && (
            <Card>
              <CardContent className="pt-6">
                <p className="text-destructive">{error}</p>
              </CardContent>
            </Card>
          )}

          {payload && (
            <>
              <Card>
                <CardContent className="pt-6">
                  <ScrapeSummary summary={payload.summary} />
                </CardContent>
              </Card>

              {entries.length > 0 && (
                <Card>
                  <Collapsible open={!logsCollapsed} onOpenChange={(open) => setLogsCollapsed(!open)}>
                    <CardHeader className="flex flex-row items-center justify-between gap-3">
                      <CardTitle className="text-base">Scrape Logs</CardTitle>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCopyLogs}
                          disabled={copyStatus === "copied"}
                        >
                          {copyStatus === "copied"
                            ? "Copied"
                            : copyStatus === "failed"
                              ? "Copy failed"
                              : "Copy logs"}
                        </Button>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm">
                            {logsCollapsed ? "Show" : "Hide"}
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                    </CardHeader>
                    <CollapsibleContent>
                      <CardContent className="pt-0">
                        <ScrapeLogs entries={entries} />
                      </CardContent>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              )}

              <Card>
                <CardContent className="pt-6">
                  <TransactionTable rows={payload.rows} />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <SkippedList skipped={payload.skipped} />
                </CardContent>
              </Card>

              {ynabResult && (
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-green-600 font-medium">
                      YNAB: {ynabResult.imported} imported, {ynabResult.duplicates} already in YNAB.
                    </p>
                    {ynabResult.unmapped.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Not mapped (map them in the YNAB tab): {ynabResult.unmapped.join(", ")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => void importRows(payload.rows, payload.runId)}
                  disabled={ynabImporting}
                >
                  {ynabImporting ? "Sending..." : "Send to YNAB"}
                </Button>
                {!exportResult ? (
                  <Button onClick={handleExport} disabled={exporting}>
                    {exporting ? "Exporting..." : "Export CSV"}
                  </Button>
                ) : (
                  <Card className="flex-1">
                    <CardContent className="pt-6">
                      <p className="text-sm text-green-600 font-medium">Export successful!</p>
                      <ul className="mt-1 text-xs text-muted-foreground">
                        {exportResult.csvPaths.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                        <li>Audit log: {exportResult.auditLogPath}</li>
                      </ul>
                      <div className="mt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleOpenOutput}
                          disabled={openingOutput}
                        >
                          {openingOutput ? "Opening..." : "Open output folder"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
                <div data-testid="sc-again-fixed">
                  <Button variant="outline" onClick={handleReset}>
                    Scrape Again
                  </Button>
                </div>
              </div>
            </>
          )}

          {!payload && (
            <Button variant="outline" onClick={handleBack}>
              Back to settings
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
