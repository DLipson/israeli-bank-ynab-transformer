import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrapeSummary } from "@/components/ScrapeSummary";
import { TransactionTable } from "@/components/TransactionTable";
import { SkippedList } from "@/components/SkippedList";
import {
  exportCSV,
  getRun,
  getRuns,
  importToYnab,
  type RunRecord,
  type RunSummary,
} from "@/api/client";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IL", { dateStyle: "medium", timeStyle: "short" });
}

function formatCurrency(amount: number): string {
  return `₪${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ActivityList({ run }: { run: Pick<RunRecord, "exports" | "ynabImports"> }) {
  if (run.exports.length === 0 && run.ynabImports.length === 0) {
    return <p className="text-xs text-muted-foreground">Not exported or sent to YNAB yet.</p>;
  }
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {run.exports.map((e) => (
        <li key={`e-${e.at}`}>
          {formatDateTime(e.at)}: CSV export to {e.csvPaths.join(", ")}
        </li>
      ))}
      {run.ynabImports.map((i) => (
        <li key={`y-${i.at}`}>
          {formatDateTime(i.at)}: YNAB, {i.imported} imported, {i.duplicates} already in YNAB
          {i.unmapped.length > 0 && `, not mapped: ${i.unmapped.join(", ")}`}
        </li>
      ))}
    </ul>
  );
}

function RunDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [run, setRun] = useState<RunRecord | null>(null);
  const [split, setSplit] = useState(false);
  const [busy, setBusy] = useState<"" | "export" | "ynab">("");
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      getRun(id)
        .then(setRun)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load run")),
    [id]
  );

  useEffect(() => {
    load();
  }, [load]);

  const act = async (kind: "export" | "ynab") => {
    if (!run) return;
    setBusy(kind);
    setError("");
    try {
      if (kind === "export") {
        await exportCSV({
          rows: run.payload.rows,
          outputDir: `./output/run-${run.id}`,
          split,
          auditLog: run.payload.auditLog,
          runId: run.id,
        });
      } else {
        await importToYnab(run.payload.rows, run.id);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy("");
    }
  };

  const failed = run?.accounts.filter((a) => !a.success) ?? [];

  return (
    <div className="space-y-4">
      <Button variant="outline" onClick={onBack}>
        Back to history
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {run && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Scrape of {formatDateTime(run.createdAt)}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {run.settings.daysBack} days back · {run.settings.accounts.join(", ")}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {failed.map((a) => (
                <p key={a.accountName} className="text-sm text-destructive">
                  {a.accountName} failed: {a.error}
                </p>
              ))}
              <ActivityList run={run} />
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => act("export")} disabled={busy !== ""}>
                  {busy === "export" ? "Exporting..." : "Export CSV"}
                </Button>
                <div className="flex items-center gap-2">
                  <Switch id="history-split" checked={split} onCheckedChange={setSplit} />
                  <Label htmlFor="history-split">Split by account</Label>
                </div>
                <Button variant="outline" onClick={() => act("ynab")} disabled={busy !== ""}>
                  {busy === "ynab" ? "Sending..." : "Send to YNAB"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <ScrapeSummary summary={run.payload.summary} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <TransactionTable rows={run.payload.rows} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <SkippedList skipped={run.payload.skipped} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export function HistoryPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (selectedId) return;
    getRuns()
      .then(setRuns)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load history"))
      .finally(() => setLoading(false));
  }, [selectedId]);

  if (selectedId) {
    return <RunDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  if (loading) {
    return <div className="p-4 text-muted-foreground">Loading history...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scrape History</CardTitle>
        <p className="text-xs text-muted-foreground">Runs from the last 90 days. Click a run to open it.</p>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && runs.length === 0 && (
          <p className="text-sm text-muted-foreground">No scrapes yet.</p>
        )}
        {runs.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Accounts</TableHead>
                <TableHead className="text-right">Transactions</TableHead>
                <TableHead className="text-right">Outflow</TableHead>
                <TableHead>Exported</TableHead>
                <TableHead>YNAB</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const lastImport = run.ynabImports.at(-1);
                return (
                  <TableRow key={run.id} className="cursor-pointer" onClick={() => setSelectedId(run.id)}>
                    <TableCell>{formatDateTime(run.createdAt)}</TableCell>
                    <TableCell>
                      {run.accounts.map((a, index) => (
                        <span key={a.accountName} className={a.success ? "" : "text-destructive"}>
                          {index > 0 && ", "}
                          {a.accountName}
                        </span>
                      ))}
                    </TableCell>
                    <TableCell className="text-right">{run.rowCount}</TableCell>
                    <TableCell className="text-right">{formatCurrency(run.totalOutflow)}</TableCell>
                    <TableCell>{run.exports.length > 0 ? "Yes" : "No"}</TableCell>
                    <TableCell>{lastImport ? `${lastImport.imported} imported` : "No"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
