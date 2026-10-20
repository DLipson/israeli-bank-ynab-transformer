import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateReport, getReports, type Report, type ReportType } from "@/api/client";
import { card, label } from "@/lib/rows";
import { formatDate, monthLabel, shekels } from "@/lib/spending";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  good: "text-green-700 dark:text-green-400",
  bad: "text-red-700 dark:text-red-400",
  warn: "text-amber-700 dark:text-amber-400",
  muted: "text-muted-foreground",
};

const OLD_NAMES: Record<Exclude<ReportType, "monthly">, string> = { weekly: "Weekly", "month-start": "Start of month", "month-end": "End of month" };

type Section = Report["sections"][number];

/** Income (grey) and spending (red when over the income) per month. */
function Chart({ data }: { data: NonNullable<Section["chart"]> }) {
  const max = Math.max(1, ...data.flatMap((m) => [m.income, m.spent]));
  return (
    <div className="mb-2 mt-1 flex h-28 items-end gap-3" role="img" aria-label="Income and spending, last 6 months">
      {data.map((m) => (
        <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${monthLabel(m.month)}: income ${shekels(m.income)}, spent ${shekels(m.spent)}`}>
          <div className="flex h-24 w-full items-end justify-center gap-0.5">
            <div className="w-1/3 rounded-t bg-muted-foreground/60" style={{ height: `${(m.income / max) * 100}%` }} />
            <div className={cn("w-1/3 rounded-t", m.spent > m.income ? "bg-red-500" : "bg-foreground/70")} style={{ height: `${(m.spent / max) * 100}%` }} />
          </div>
          <span className="text-[11px] text-muted-foreground">{monthLabel(m.month).split(" ")[0]}</span>
        </div>
      ))}
    </div>
  );
}

function Rows({ rows }: { rows: Section["rows"] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.label}-${i}`} className="border-b last:border-0">
            <td className={cn("py-1 pr-3", row.tone && TONE[row.tone])} dir="auto">
              {row.label}
            </td>
            <td className={cn("py-1 text-right", row.tone && TONE[row.tone])} dir="auto">
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReportView({ report }: { report: Report }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Made {new Date(report.generatedAt).toLocaleString("en-IL", { dateStyle: "medium", timeStyle: "short" })} · transaction data through {formatDate(report.dataAsOf)}
      </p>
      {report.sections.map((s) => (
        <section key={s.title}>
          <p className="text-sm font-semibold">{s.title}</p>
          {s.chart && <Chart data={s.chart} />}
          <Rows rows={s.rows} />
          {s.explanation && <p className="mt-1.5 text-xs text-muted-foreground">{s.explanation}</p>}
          {s.note && <p className="mt-1 text-xs text-muted-foreground">{s.note}</p>}
          {s.details && s.details.length > 0 && (
            <details className="mt-2 rounded-md border px-3 py-1.5">
              <summary className="cursor-pointer text-xs font-medium">How this was worked out</summary>
              <Rows rows={s.details} />
            </details>
          )}
        </section>
      ))}
    </div>
  );
}

/** The monthly report (opens from Home), and older saved reports below it. */
export function ReportsPage() {
  const [reports, setReports] = useState<Record<ReportType, Report | null> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    getReports()
      .then(setReports)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load reports"));
  }, []);

  const make = async () => {
    setBusy(true);
    setError("");
    try {
      const report = await generateReport("monthly");
      setReports((all) => (all ? { ...all, monthly: report } : all));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (!reports) return error ? <p className="text-sm text-destructive">{error}</p> : <p className="flex items-center gap-2 p-4 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading reports…</p>;
  const monthly = reports.monthly;
  const older = (Object.keys(OLD_NAMES) as Array<keyof typeof OLD_NAMES>).filter((t) => reports[t]);

  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium">{monthly?.title ?? "Monthly report"}</p>
            <p className={label}>Made on the 1st of each month by the daily task.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void make()} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Make it again now
          </Button>
        </div>
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
        {monthly ? <ReportView report={monthly} /> : <p className="text-sm text-muted-foreground">Not made yet.</p>}
      </div>

      {older.length > 0 && (
        <div className={card}>
          <p className={cn(label, "mb-1")}>Older reports (no longer made)</p>
          {older.map((t) => (
            <details key={t} className="border-t py-1.5">
              <summary className="cursor-pointer text-sm">
                {OLD_NAMES[t]} · {reports[t]!.title}
              </summary>
              <div className="mt-2">
                <ReportView report={reports[t]!} />
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
