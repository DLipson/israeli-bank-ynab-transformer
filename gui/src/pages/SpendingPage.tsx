import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  generateReport,
  getReports,
  getSpending,
  type Report,
  type ReportType,
  type SpendingData,
} from "@/api/client";
import { formatDate, monthLabel, SpendingContext, useSpending } from "@/lib/spending";
import { readStoredJson, writeStoredJson } from "@/lib/scrape-run";

const REPORT_INFO: Record<ReportType, { name: string; when: string }> = {
  weekly: { name: "Weekly", when: "Every Sunday at 10:00" },
  "month-start": { name: "Start of month", when: "On the 1st" },
  "month-end": { name: "End of month", when: "On the last day" },
};

function reportActionLabel(type: ReportType): string {
  const today = new Date().toISOString().slice(0, 10);
  if (type === "weekly") return "Make this week's report";
  if (type === "month-start") return `Make ${monthLabel(today.slice(0, 7))} start report`;

  const [year, month, day] = today.split("-").map(Number);
  const thisMonth = today.slice(0, 7);
  const target =
    day === new Date(Date.UTC(year, month, 0)).getUTCDate()
      ? thisMonth
      : new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 7);
  return `Make ${monthLabel(target)} report`;
}

function reportFreshness(report: Report): string {
  if (report.lastScrapedAt === undefined) return "scrape time not saved";
  if (!report.lastScrapedAt) return "no successful scrape recorded";
  return `last successful bank scrape ${new Date(report.lastScrapedAt).toLocaleString("en-IL", { dateStyle: "medium", timeStyle: "short" })}`;
}

const TONE: Record<string, string> = {
  good: "text-green-700",
  bad: "text-red-700",
  warn: "text-amber-700",
  muted: "text-muted-foreground",
};

function ReportCard({ type, report, onMade }: { type: ReportType; report: Report | null; onMade: (r: Report) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const make = async () => {
    setBusy(true);
    setError("");
    try {
      onMade(await generateReport(type));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{report?.title ?? REPORT_INFO[type].name}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {REPORT_INFO[type].when}
              {report && ` · made ${new Date(report.generatedAt).toLocaleString("en-IL", { dateStyle: "medium", timeStyle: "short" })} · transaction data through ${formatDate(report.dataAsOf)} · ${reportFreshness(report)}`}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={make} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {reportActionLabel(type)}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        {!report && <p className="text-sm text-muted-foreground">Not made yet.</p>}
        {report && (
          <>
            {report.sections.slice(0, 1).map((section) => (
              <section key={section.title}>
                <p className="text-sm font-semibold">{section.title}</p>
                <table className="w-full text-sm">
                  <tbody>
                    {section.rows.map((row, i) => (
                      <tr key={`${row.label}-${i}`} className="border-b last:border-0">
                        <td className={cn("py-1 pr-3", row.tone && TONE[row.tone])} dir="auto">{row.label}</td>
                        <td className={cn("py-1 text-right", row.tone && TONE[row.tone])} dir="auto">{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {section.explanation && <p className="mt-2 text-xs text-muted-foreground">{section.explanation}</p>}
                {section.note && <p className="mt-1 text-xs text-muted-foreground">{section.note}</p>}
                <details className="mt-3 rounded-md border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium">How this number was worked out</summary>
                  {section.details ? (
                    section.details.length ? (
                      <table className="mt-2 w-full text-sm">
                        <tbody>
                          {section.details.map((row, i) => (
                            <tr key={`${row.label}-${i}`} className="border-b last:border-0">
                              <td className={cn("py-1 pr-3", row.tone && TONE[row.tone])} dir="auto">{row.label}</td>
                              <td className={cn("py-1 text-right", row.tone && TONE[row.tone])} dir="auto">{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">No separate line items were needed for this number.</p>
                    )
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">This older report was saved before its calculation details were kept.</p>
                  )}
                </details>
              </section>
            ))}
            {report.sections.slice(1).map((section) => (
              <details key={section.title} className="rounded-md border px-3 py-2">
                <summary className="cursor-pointer text-sm font-semibold">{section.title}</summary>
                <table className="mt-2 w-full text-sm">
                  <tbody>
                    {section.rows.map((row, i) => (
                      <tr key={`${row.label}-${i}`} className="border-b last:border-0">
                        <td className={cn("py-1 pr-3", row.tone && TONE[row.tone])} dir="auto">{row.label}</td>
                        <td className={cn("py-1 text-right", row.tone && TONE[row.tone])} dir="auto">{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {section.explanation && <p className="mt-2 text-xs text-muted-foreground">{section.explanation}</p>}
                {section.note && <p className="mt-1 text-xs text-muted-foreground">{section.note}</p>}
              </details>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ReportsPanel() {
  const [reports, setReports] = useState<Record<ReportType, Report | null> | null>(null);
  const [selected, setSelected] = useState<ReportType>("weekly");
  const [error, setError] = useState("");
  useEffect(() => {
    getReports()
      .then((loaded) => {
        setReports(loaded);
        const latest = (Object.keys(REPORT_INFO) as ReportType[])
          .map((type) => loaded[type])
          .filter((report): report is Report => report !== null)
          .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
        if (latest) setSelected(latest.type);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load reports"));
  }, []);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!reports) return <p className="flex items-center gap-2 p-4 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading reports…</p>;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        The daily task saves each report when it is due. Generate a fresh report for the period named on its button.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a report">
        {(Object.keys(REPORT_INFO) as ReportType[]).map((type) => (
          <Button
            key={type}
            type="button"
            size="sm"
            variant={selected === type ? "default" : "outline"}
            aria-pressed={selected === type}
            onClick={() => setSelected(type)}
          >
            {REPORT_INFO[type].name}{!reports[type] && " · Not made yet"}
          </Button>
        ))}
      </div>
      <ReportCard
        key={selected}
        type={selected}
        report={reports[selected]}
        onMade={(r) => setReports((all) => (all ? { ...all, [selected]: r } : all))}
      />
    </div>
  );
}

// --- Shared data for Home, Inbox, Cards, and Settings ---

const CACHE_KEY = "spending.data.v2";

/** Loads the spending numbers once for every tab that shows them; reload() refreshes them. */
export function SpendingProvider({ children }: { children: ReactNode }) {
  // The last numbers show at once; the request (about 10 s) then replaces them.
  const [data, setData] = useState<SpendingData | null>(() => {
    const cached = readStoredJson<SpendingData | null>(CACHE_KEY, null);
    return cached?.available && cached.spentVsIncome ? cached : null;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const latest = useRef(0);

  const reload = useCallback(async (options: { quick?: boolean } = {}) => {
    const request = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const next = await getSpending(options.quick);
      if (request === latest.current) {
        setData(next);
        try {
          writeStoredJson(CACHE_KEY, next);
        } catch {
          // Storage full or blocked: the numbers still show, only the next start is slower.
        }
      }
    } catch (e) {
      if (request === latest.current) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, []);

  // React development mode runs effects twice; load once.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    reload();
  }, [reload]);

  const removeSuggestion = useCallback(
    (id: string) => {
      setData((d) => (d ? { ...d, suggestions: d.suggestions.filter((s) => s.id !== id) } : d));
      reload();
    },
    [reload]
  );

  return (
    <SpendingContext.Provider value={{ data, loading, error, reload, removeSuggestion }}>{children}</SpendingContext.Provider>
  );
}

/** Shown while the spending numbers load, or when loading failed. */
export function SpendingLoading() {
  const { error } = useSpending();
  return (
    <div className="flex items-center gap-2 p-4 text-muted-foreground">
      {error ? <span className="text-destructive">{error}</span> : <><Loader2 className="h-4 w-4 animate-spin" /> Loading your numbers from YNAB…</>}
    </div>
  );
}
