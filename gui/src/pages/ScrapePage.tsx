import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrapeSettings } from "@/components/ScrapeSettings";
import { ScrapeProgress, type AccountStatus } from "@/components/ScrapeProgress";
import { ScrapeSummary } from "@/components/ScrapeSummary";
import { TransactionTable } from "@/components/TransactionTable";
import { SkippedList } from "@/components/SkippedList";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  createScrapeStream,
  exportCSV,
  openPath,
  getAccounts,
  cancelScrape,
  type ScrapePayload,
  type SSEEvent,
  type AccountInfo,
} from "@/api/client";

type Phase = "settings" | "progress" | "results";
type ExportResult = { csvPaths: string[]; auditLogPath: string };
type StoredSettings = {
  daysBack: number;
  outputDir: string;
  split: boolean;
  showBrowser: boolean;
  enableDetailedLogging: boolean;
  detailedLoggingLimit: number;
  selectedAccounts: string[];
};

const STORAGE_KEYS = {
  settings: "scrape.settings.v1",
  payload: "scrape.payload.v1",
  exportResult: "scrape.exportResult.v1",
};

function readStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStoredJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function removeStored(key: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

export function ScrapePage() {
  const initialRef = useRef<{
    settings: Partial<StoredSettings>;
    payload: ScrapePayload | null;
    exportResult: ExportResult | null;
  } | null>(null);
  if (!initialRef.current) {
    initialRef.current = {
      settings: readStoredJson<Partial<StoredSettings>>(STORAGE_KEYS.settings, {}),
      payload: readStoredJson<ScrapePayload | null>(STORAGE_KEYS.payload, null),
      exportResult: readStoredJson<ExportResult | null>(STORAGE_KEYS.exportResult, null),
    };
  }
  const initialSettings = initialRef.current.settings;

  const [phase, setPhase] = useState<Phase>(() =>
    initialRef.current?.payload ? "results" : "settings"
  );

  // Settings state
  const [daysBack, setDaysBack] = useState(() => initialSettings.daysBack ?? 60);
  const [outputDir, setOutputDir] = useState(() => initialSettings.outputDir ?? "./output");
  const [split, setSplit] = useState(() => initialSettings.split ?? false);
  const [showBrowser, setShowBrowser] = useState(() => initialSettings.showBrowser ?? false);
  const [enableDetailedLogging, setEnableDetailedLogging] = useState(
    () => initialSettings.enableDetailedLogging ?? false
  );
  const [detailedLoggingLimit, setDetailedLoggingLimit] = useState(
    () => initialSettings.detailedLoggingLimit ?? 10
  );
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(
    () => initialSettings.selectedAccounts ?? []
  );

  // Progress state
  const [accountStatuses, setAccountStatuses] = useState<AccountStatus[]>([]);
  const [messages, setMessages] = useState<string[]>([]);

  // Results state
  const [payload, setPayload] = useState<ScrapePayload | null>(
    () => initialRef.current?.payload ?? null
  );
  const [exporting, setExporting] = useState(false);
  const [openingOutput, setOpeningOutput] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(
    () => initialRef.current?.exportResult ?? null
  );
  const [error, setError] = useState("");
  const [logsCollapsed, setLogsCollapsed] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const streamRef = useRef<EventSource | null>(null);
  const scrapeIdRef = useRef<string | null>(null);

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
    return () => {
      if (streamRef.current) {
        streamRef.current.close();
        streamRef.current = null;
      }
      scrapeIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    writeStoredJson(STORAGE_KEYS.settings, {
      daysBack,
      outputDir,
      split,
      showBrowser,
      enableDetailedLogging,
      detailedLoggingLimit,
      selectedAccounts,
    });
  }, [
    daysBack,
    outputDir,
    split,
    showBrowser,
    enableDetailedLogging,
    detailedLoggingLimit,
    selectedAccounts,
  ]);

  useEffect(() => {
    if (payload) {
      writeStoredJson(STORAGE_KEYS.payload, payload);
    } else {
      removeStored(STORAGE_KEYS.payload);
    }
  }, [payload]);

  useEffect(() => {
    if (exportResult) {
      writeStoredJson(STORAGE_KEYS.exportResult, exportResult);
    } else {
      removeStored(STORAGE_KEYS.exportResult);
    }
  }, [exportResult]);

  useEffect(() => {
    if (accountsLoading) return;
    if (accountsError) return;
    const enabledNames = accounts.filter((account) => account.enabled).map((account) => account.name);
    if (enabledNames.length === 0) return;
    const validSelected = selectedAccounts.filter((name) => enabledNames.includes(name));
    if (validSelected.length === 0) {
      setSelectedAccounts(enabledNames);
    } else if (validSelected.length !== selectedAccounts.length) {
      setSelectedAccounts(validSelected);
    }
  }, [accounts, accountsError, accountsLoading, selectedAccounts]);

  const handleStart = useCallback(() => {
    if (selectedAccounts.length === 0) {
      setError("Select at least one account to scrape.");
      setPhase("results");
      return;
    }

    setPhase("progress");
    setAccountStatuses(
      selectedAccounts.map((name) => ({
        name,
        status: "pending" as const,
        message: "Pending",
      }))
    );
    setMessages([]);
    setPayload(null);
    setExportResult(null);
    setError("");
    setLogsCollapsed(false);
    setCopyStatus("idle");

    const scrapeId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    scrapeIdRef.current = scrapeId;

    const stream = createScrapeStream(
      daysBack,
      showBrowser,
      enableDetailedLogging,
      detailedLoggingLimit,
      selectedAccounts,
      scrapeId,
      (event: SSEEvent) => {
        switch (event.type) {
          case "warning":
            setMessages((prev) => [...prev, `Warning: ${event.message}`]);
            break;

          case "progress":
            setMessages((prev) => [...prev, event.message ?? ""]);
            // Try to detect which account is being worked on
            if (event.message) {
              const scrapeMatch = event.message.match(/^Scraping (.+)\.\.\.$/);
              if (scrapeMatch) {
                const name = scrapeMatch[1].replace(/^\n/, "");
                setAccountStatuses((prev) => {
                  const exists = prev.find((a) => a.name === name);
                  if (exists) {
                    return prev.map((a) =>
                      a.name === name
                        ? { ...a, status: "scraping" as const, message: "Scraping..." }
                        : a
                    );
                  }
                  return [...prev, { name, status: "scraping" as const, message: "Scraping..." }];
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
                message: event.success
                  ? `${event.transactionCount} transactions`
                  : (event.error ?? "Failed"),
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
  }, [
    daysBack,
    showBrowser,
    enableDetailedLogging,
    detailedLoggingLimit,
    selectedAccounts,
  ]);

  const handleExport = async () => {
    if (!payload) return;
    setExporting(true);
    setError("");
    try {
      const result = await exportCSV({
        rows: payload.rows,
        outputDir,
        split,
        scrapeResults: payload.scrapeResults,
        skipped: payload.skipped,
        auditLog: payload.auditLog,
      });
      setExportResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleReset = () => {
    setPhase("settings");
    setPayload(null);
    setExportResult(null);
    setError("");
    setCopyStatus("idle");
  };

  const handleCancel = async () => {
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
  };

  const handleCopyLogs = async () => {
    if (messages.length === 0) return;
    const text = messages.join("\n");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
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
              enableDetailedLogging={enableDetailedLogging}
              setEnableDetailedLogging={setEnableDetailedLogging}
              detailedLoggingLimit={detailedLoggingLimit}
              setDetailedLoggingLimit={setDetailedLoggingLimit}
              accounts={accounts}
              selectedAccounts={selectedAccounts}
              setSelectedAccounts={setSelectedAccounts}
              accountsLoading={accountsLoading}
              accountsError={accountsError}
              onStart={handleStart}
              disabled={phase === "progress"}
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
            <ScrapeProgress accounts={accountStatuses} messages={messages} />
            <div className="mt-4">
              <Button variant="outline" onClick={handleCancel}>
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

              {messages.length > 0 && (
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
                        <div className="max-h-64 overflow-y-auto rounded-md bg-muted p-3 text-xs font-mono">
                          {messages.map((msg, i) => (
                            <div key={i} className="text-muted-foreground">
                              {msg}
                            </div>
                          ))}
                        </div>
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

              <div className="flex gap-2">
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
                <Button variant="outline" onClick={handleReset}>
                  Scrape Again
                </Button>
              </div>
            </>
          )}

          {!payload && !error && (
            <Button variant="outline" onClick={handleReset}>
              Back
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
