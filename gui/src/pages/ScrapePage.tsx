import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrapeSettings } from "@/components/ScrapeSettings";
import { ScrapeProgress, type AccountStatus } from "@/components/ScrapeProgress";
import { ScrapeSummary } from "@/components/ScrapeSummary";
import { TransactionTable } from "@/components/TransactionTable";
import { SkippedList } from "@/components/SkippedList";
import { createScrapeStream, exportCSV, openPath, type ScrapePayload, type SSEEvent } from "@/api/client";

type Phase = "settings" | "progress" | "results";

export function ScrapePage() {
  const [phase, setPhase] = useState<Phase>("settings");

  // Settings state
  const [daysBack, setDaysBack] = useState(60);
  const [outputDir, setOutputDir] = useState("./output");
  const [split, setSplit] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [enableDetailedLogging, setEnableDetailedLogging] = useState(false);
  const [detailedLoggingLimit, setDetailedLoggingLimit] = useState(10);

  // Progress state
  const [accountStatuses, setAccountStatuses] = useState<AccountStatus[]>([]);
  const [messages, setMessages] = useState<string[]>([]);

  // Results state
  const [payload, setPayload] = useState<ScrapePayload | null>(null);
  const [exporting, setExporting] = useState(false);
  const [openingOutput, setOpeningOutput] = useState(false);
  const [exportResult, setExportResult] = useState<{
    csvPaths: string[];
    auditLogPath: string;
  } | null>(null);
  const [error, setError] = useState("");

  const handleStart = useCallback(() => {
    setPhase("progress");
    setAccountStatuses([]);
    setMessages([]);
    setPayload(null);
    setExportResult(null);
    setError("");

    createScrapeStream(
      daysBack,
      showBrowser,
      enableDetailedLogging,
      detailedLoggingLimit,
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
  }, [daysBack, showBrowser, enableDetailedLogging, detailedLoggingLimit]);

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
              onStart={handleStart}
              disabled={false}
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
