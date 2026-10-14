import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarPlus, ChevronRight, Loader2, Plus, Trash2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createScheduled,
  generateReport,
  getReports,
  getSpending,
  ignoreScheduleSuggestion,
  saveSpendingSettings,
  dismissAnomaly,
  type Anomaly,
  type CategoryOption,
  type CreditLimitGroup,
  type LeftToSpend,
  type Pace,
  type Report,
  type ReportType,
  type ScheduleSuggestion,
  type SpendingData,
  type SpendingSettings,
} from "@/api/client";
import { formatDate, K, monthLabel, shekels, SpendingContext, useSpending } from "@/lib/spending";

function Lines({ result }: { result: LeftToSpend }) {
  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <tbody>
          {result.lines.map((l, i) => (
            <tr key={`${l.label}-${i}`} className="border-b last:border-0">
              <td className="py-1 pr-4" dir="auto">
                {l.label}
              </td>
              <td className={cn("py-1 text-right font-mono", l.amount < 0 && "text-red-700")}>{shekels(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.warnings.map((w) => (
        <p key={w} className="flex items-start gap-1 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
        </p>
      ))}
    </div>
  );
}

const MODE_NAMES = { cashflow: "Cash-flow", ynab: "YNAB categories" } as const;

/** The main number, its mode switch, and how it is built: for Home's "Details". */
export function NumberDetails({ data, onMode }: { data: SpendingData; onMode: (mode: SpendingSettings["mode"]) => void }) {
  const mode = data.settings.mode;
  const main = mode === "cashflow" ? data.cashflow : data.ynab;
  const other = mode === "cashflow" ? data.ynab : data.cashflow;
  const otherMode = mode === "cashflow" ? "ynab" : "cashflow";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {MODE_NAMES[otherMode]}: <span className="font-medium text-foreground">{shekels(other.total)}</span>
        </p>
        <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label="Main number">
          {(["cashflow", "ynab"] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => mode !== m && onMode(m)}
              className={cn(
                "rounded px-3 py-1 text-sm transition-colors",
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {MODE_NAMES[m]}
            </button>
          ))}
        </div>
      </div>
      {data.readyToAssign > 0 && Math.abs(data.gap) > K && (
        <p className="text-xs text-muted-foreground">
          The two numbers differ by {shekels(Math.abs(data.gap))}, mostly because {shekels(data.readyToAssign)} is still in
          YNAB's Ready to Assign.
        </p>
      )}
      <Lines result={main} />
    </div>
  );
}

function SuggestionRow({
  s,
  accountName,
  categories,
  onDone,
}: {
  s: ScheduleSuggestion;
  accountName: string;
  categories: CategoryOption[];
  onDone: (id: string) => void;
}) {
  const [payee, setPayee] = useState(s.label);
  const [amount, setAmount] = useState(String(Math.round(s.amount / K)));
  const [date, setDate] = useState(s.nextDate);
  const [categoryId, setCategoryId] = useState(s.categoryId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      onDone(s.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  };

  const [open, setOpen] = useState(false);
  const amountValue = Number(amount);
  const valid = Boolean(payee.trim() && amountValue > 0 && date);
  const categoryName = categories.find((c) => c.id === categoryId)?.name ?? "No category";
  const create = () =>
    run(() =>
      createScheduled({ accountId: s.accountId, date, amount: Math.round(amountValue * K), payeeName: payee, categoryId: categoryId || null })
    );

  // One compact line; the edit fields open below it. The line always shows the values that Create will use.
  return (
    <div className={cn("rounded-md border", open && "bg-muted/30")}>
      <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title={open ? "Close" : "Edit before creating"}
        >
          <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <span className="line-clamp-2 break-words font-medium" dir="auto">
            {payee}
          </span>
          {s.amountVaries && (
            <AlertTriangle
              className="h-3.5 w-3.5 shrink-0 text-amber-600"
              aria-label="Amount varies"
            />
          )}
        </button>
        <span className="shrink-0 text-right font-mono">₪{amountValue.toLocaleString("en-US")}</span>
        <span className="hidden w-14 shrink-0 text-xs text-muted-foreground sm:block">{formatDate(date)}</span>
        <span className="hidden w-36 shrink-0 truncate text-xs text-muted-foreground md:block" dir="auto" title={categoryName}>
          {categoryName}
        </span>
        <Button size="sm" className="h-7 px-2" disabled={busy || !valid} onClick={create} title="Create a monthly scheduled transaction in YNAB">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />} Create
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          disabled={busy}
          onClick={() => run(() => ignoreScheduleSuggestion(s.id))}
          title="Ignore this suggestion"
          aria-label="Ignore"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {open && (
        <div className="space-y-2 border-t px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={payee} onChange={(e) => setPayee(e.target.value)} dir="auto" className="h-8 min-w-48 flex-1" aria-label="Payee" />
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">₪</span>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                className="h-8 w-24 text-right"
                aria-label="Amount"
              />
            </div>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-40" aria-label="First date" />
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              aria-label="Category"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.group} / {c.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            Monthly · {accountName} · seen in {s.months} of the last 4 months
          </p>
          {s.amountVaries && (
            <p className="flex items-start gap-1 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> The amount changed between months. YNAB matches an
              imported transaction to a scheduled one only when the amount is exactly the same, so you may get a duplicate.
            </p>
          )}
        </div>
      )}
      {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

const PACE_LABEL: Record<Pace["status"], string> = {
  under: "under pace",
  on: "on pace",
  over: "over pace",
  "fixed-paid": "paid",
  "fixed-due": "not paid yet",
};

export function PaceBadge({ p }: { p: Pace }) {
  const style =
    p.status === "over"
      ? "bg-red-100 text-red-800"
      : p.status === "under"
        ? "bg-green-100 text-green-800"
        : "bg-muted text-muted-foreground";
  const pct = p.difference === null ? "" : ` ${p.difference > 0 ? "+" : ""}${Math.round(p.difference * 100)}%`;
  return <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium", style)}>{PACE_LABEL[p.status]}{pct}</span>;
}

function PaceRow({ p }: { p: Pace }) {
  return (
    <div className="flex items-center gap-3 py-1 text-sm">
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {p.name}
      </span>
      {p.status.startsWith("fixed") ? (
        <span className="text-xs text-muted-foreground">normally {shekels(p.normalMonth)}</span>
      ) : (
        <span className="font-mono text-xs">
          {shekels(p.thisMonth)} <span className="text-muted-foreground">/ {shekels(p.normalByToday)}</span>
        </span>
      )}
      <PaceBadge p={p} />
    </div>
  );
}

/** Pace this month vs. a normal month up to the same day (the date of the newest import). */
export function PaceCard({ data }: { data: SpendingData }) {
  const b = data.baseline;
  const age = Math.round((Date.parse(data.today) - Date.parse(b.asOf)) / 86400000);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Pace this month <PaceBadge p={b.total} />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Spent {shekels(b.total.thisMonth)} up to {formatDate(b.asOf)}; a normal month by then is {shekels(b.total.normalByToday)} (middle
          value of the last {b.months} months). A whole normal month is {shekels(b.total.normalMonth)}.
          {age >= 3 && <span className="text-amber-700"> The newest bank data is {age} days old: run a scrape for a fair pace.</span>}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {b.topOver.length > 0 ? (
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Most over pace</p>
            {b.topOver.map((p) => (
              <PaceRow key={p.name} p={p} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No category is over pace.</p>
        )}
        {b.uncategorized > 0 && (
          <p className="text-xs text-amber-700">{shekels(b.uncategorized)} this month is not categorized yet, so no category pace includes it.</p>
        )}
        <details>
          <summary className="cursor-pointer text-sm font-medium">All categories ({b.categories.length})</summary>
          <div className="mt-1 divide-y">
            {b.categories.map((p) => (
              <PaceRow key={p.name} p={p} />
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

const REPORT_INFO: Record<ReportType, { name: string; when: string }> = {
  weekly: { name: "Weekly", when: "Every Sunday at 10:00" },
  "month-start": { name: "Start of month", when: "On the 1st" },
  "month-end": { name: "End of month", when: "On the last day" },
};

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
              {report && ` · made ${new Date(report.generatedAt).toLocaleString("en-IL", { dateStyle: "medium", timeStyle: "short" })} · bank data up to ${formatDate(report.dataAsOf)}`}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={make} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Make now
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        {!report && <p className="text-sm text-muted-foreground">Not made yet.</p>}
        {report?.sections.map((section) => (
          <section key={section.title}>
            <p className="text-sm font-semibold">{section.title}</p>
            <table className="w-full text-sm">
              <tbody>
                {section.rows.map((row, i) => (
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
            {section.note && <p className="mt-1 text-xs text-muted-foreground">{section.note}</p>}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

export function ReportsPanel() {
  const [reports, setReports] = useState<Record<ReportType, Report | null> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    getReports()
      .then(setReports)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load reports"));
  }, []);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!reports) return <p className="flex items-center gap-2 p-4 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading reports…</p>;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        The daily task makes each report when it is due and saves it here. "Make now" builds a fresh one from today's data.
      </p>
      {(Object.keys(REPORT_INFO) as ReportType[]).map((type) => (
        <ReportCard key={type} type={type} report={reports[type]} onMade={(r) => setReports((all) => (all ? { ...all, [type]: r } : all))} />
      ))}
    </div>
  );
}

export function Exposure({ data }: { data: SpendingData }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Credit exposure</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1 font-medium">Limit group</th>
              <th className="py-1 text-right font-medium">Limit</th>
              <th className="py-1 text-right font-medium">Used</th>
              <th className="py-1 text-right font-medium">Unused</th>
            </tr>
          </thead>
          <tbody>
            {data.exposure.filter((g) => g.used > 0 || g.limit !== null).map((g) => (
              <tr key={g.name} className="border-b last:border-0" title={g.lines.map((l) => `${l.label}: ${shekels(l.amount)}`).join("\n")}>
                <td className="py-1.5" dir="auto">
                  {g.name}
                </td>
                <td className="py-1.5 text-right font-mono">{g.limit === null ? <span className="text-muted-foreground">not set</span> : shekels(g.limit)}</td>
                <td className="py-1.5 text-right font-mono">{shekels(g.used)}</td>
                <td className={cn("py-1.5 text-right font-mono", g.unused !== null && g.unused < 0 && "text-red-700")}>
                  {g.unused === null ? "—" : shekels(g.unused)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">Used = balance owed + installments still to be charged. Hover a row for details.</p>
      </CardContent>
    </Card>
  );
}

export function Obligations({ data }: { data: SpendingData }) {
  const max = Math.max(...data.obligations.map((o) => o.total), 1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Coming months</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {data.obligations.map((o) => (
          <div
            key={o.month}
            className="flex items-center gap-3 text-sm"
            title={`${shekels(o.scheduled)} scheduled + ${shekels(o.installments)} installments`}
          >
            <span className="w-20 shrink-0 text-muted-foreground">{monthLabel(o.month)}</span>
            <div className="h-2 flex-1 rounded bg-muted">
              <div className="h-2 rounded bg-primary/70" style={{ width: `${(o.total / max) * 100}%` }} />
            </div>
            <span className="w-20 text-right font-mono">{shekels(o.total)}</span>
          </div>
        ))}
        <p className="pt-2 text-xs text-muted-foreground">
          Scheduled outflows from YNAB plus installments not yet in a card balance. Income is not counted.
        </p>
      </CardContent>
    </Card>
  );
}

function SettingsPanel({ data, onSaved }: { data: SpendingData; onSaved: () => void }) {
  const s = data.settings;
  const [periodEnd, setPeriodEnd] = useState(s.periodEnd === "month-end" ? "" : String(s.periodEnd));
  const [buffer, setBuffer] = useState(String(Math.round(s.buffer / K)));
  const [months, setMonths] = useState(String(s.baselineMonths));
  const [subtract, setSubtract] = useState(s.subtractExpected);
  const [overdraft, setOverdraft] = useState(s.overdraft ?? { limitAccountId: "", accountId: "" });
  const [groups, setGroups] = useState<CreditLimitGroup[]>(s.creditLimits);
  const [flexible, setFlexible] = useState<Set<string>>(new Set(s.flexibleCategoryIds));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const checking = data.accounts.filter((a) => a.type === "checking");
  const cards = data.accounts.filter((a) => a.type === "creditCard" || a.type === "lineOfCredit");
  const byGroup = useMemo(() => {
    const map = new Map<string, CategoryOption[]>();
    for (const c of data.categories) map.set(c.group, [...(map.get(c.group) ?? []), c]);
    return [...map];
  }, [data.categories]);

  const updateGroup = (i: number, patch: Partial<CreditLimitGroup>) =>
    setGroups((g) => g.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  /** Default name for a limit group: its cards' names, e.g. "Leumi Cards + Max Card". */
  const groupName = (g: CreditLimitGroup) =>
    g.accountIds.map((id) => cards.find((c) => c.id === id)?.name).filter(Boolean).join(" + ");
  const toggleCard = (i: number, id: string) => {
    // A card belongs to one group: ticking it here removes it from the others.
    setGroups((g) =>
      g.map((x, j) => {
        if (j === i) return { ...x, accountIds: x.accountIds.includes(id) ? x.accountIds.filter((a) => a !== id) : [...x.accountIds, id] };
        return { ...x, accountIds: x.accountIds.filter((a) => a !== id) };
      })
    );
  };

  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      await saveSpendingSettings({
        periodEnd: periodEnd ? Number(periodEnd) : "month-end",
        buffer: Math.round((Number(buffer) || 0) * K),
        baselineMonths: Number(months) || 6,
        subtractExpected: subtract,
        overdraft: overdraft.limitAccountId && overdraft.accountId ? overdraft : null,
        creditLimits: groups.filter((g) => g.accountIds.length).map((g) => ({ ...g, name: g.name.trim() || groupName(g) })),
        flexibleCategoryIds: [...flexible],
      });
      setMessage("Saved.");
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const select = "h-8 rounded-md border border-input bg-background px-2 text-sm";
  return (
    <Card>
      <CardContent className="space-y-6 p-5 text-sm">
        <section className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="font-medium">Period ends</span>
            <select className={cn(select, "w-full")} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}>
              <option value="">At the end of the month</option>
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  On day {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-medium">Buffer (₪, kept aside in the cash-flow number)</span>
            <Input value={buffer} onChange={(e) => setBuffer(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="h-8" />
          </label>
          <label className="space-y-1">
            <span className="font-medium">Normal spending is measured over (months)</span>
            <Input
              value={months}
              onChange={(e) => setMonths(e.target.value.replace(/\D/g, "").slice(0, 2))}
              inputMode="numeric"
              className="h-8"
              aria-describedby="months-help"
            />
            <span id="months-help" className="text-xs text-muted-foreground">
              1 to 24 full months before this one. The middle value is used.
            </span>
          </label>
          <label className="flex items-start gap-2 pt-6">
            <input type="checkbox" className="mt-1" checked={subtract} onChange={(e) => setSubtract(e.target.checked)} />
            <span>
              <span className="font-medium">Subtract normal spending still expected this period</span>
              <span className="block text-xs text-muted-foreground">
                On: "left to spend" is what you can spend on top of your usual life. Off: the total before usual spending.
              </span>
            </span>
          </label>
        </section>

        <section className="space-y-2">
          <p className="font-medium">Overdraft</p>
          <div className="flex flex-wrap items-center gap-2">
            <span>Limit is the balance of</span>
            <select className={select} value={overdraft.limitAccountId} onChange={(e) => setOverdraft({ ...overdraft, limitAccountId: e.target.value })}>
              <option value="">(none)</option>
              {checking.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <span>and is used by</span>
            <select className={select} value={overdraft.accountId} onChange={(e) => setOverdraft({ ...overdraft, accountId: e.target.value })}>
              <option value="">(none)</option>
              {checking.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="space-y-2">
          <p className="font-medium">Card limits</p>
          <p className="text-xs text-muted-foreground">Put cards that share one limit in the same group. Cards in no group show "not set".</p>
          {groups.map((g, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1">
                  <span className="block text-xs text-muted-foreground">Credit limit (₪)</span>
                  <Input
                    value={g.limit ? String(Math.round(g.limit / K)) : ""}
                    onChange={(e) => updateGroup(i, { limit: (Number(e.target.value.replace(/\D/g, "")) || 0) * K })}
                    inputMode="numeric"
                    placeholder="20000"
                    className="h-8 w-32 text-right"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs text-muted-foreground">Name (optional)</span>
                  <Input value={g.name} onChange={(e) => updateGroup(i, { name: e.target.value })} placeholder={groupName(g) || "Leumi + Max"} className="h-8 w-48" />
                </label>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setGroups((x) => x.filter((_, j) => j !== i))} title="Remove this limit">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-xs text-muted-foreground">Cards that share this limit:</span>
                {cards.map((c) => (
                  <label key={c.id} className="flex items-center gap-1">
                    <input type="checkbox" checked={g.accountIds.includes(c.id)} onChange={() => toggleCard(i, c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setGroups((g) => [...g, { name: "", limit: 0, accountIds: [] }])}>
            <Plus className="h-3.5 w-3.5" /> Add limit group
          </Button>
        </section>

        <section className="space-y-2">
          <p className="font-medium">Flexible categories (YNAB number)</p>
          <p className="text-xs text-muted-foreground">None ticked = every category counts.</p>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {byGroup.map(([group, list]) => (
              <div key={group}>
                <p className="text-xs font-semibold text-muted-foreground">{group}</p>
                {list.map((c) => (
                  <label key={c.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={flexible.has(c.id)}
                      onChange={() =>
                        setFlexible((f) => {
                          const next = new Set(f);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </section>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save settings
          </Button>
          {message && <span className={cn("text-sm", message === "Saved." ? "text-green-700" : "text-destructive")}>{message}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Shared data for Home, Review, Reports, and Setup ---

/** Loads the spending numbers once for every tab that shows them; reload() refreshes them. */
export function SpendingProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<SpendingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const next = await getSpending();
      if (request === latest.current) setData(next);
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

  const setMode = useCallback(async (mode: SpendingSettings["mode"]) => {
    setData((d) => (d ? { ...d, settings: { ...d.settings, mode } } : d));
    try {
      await saveSpendingSettings({ mode });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the mode");
    }
  }, []);

  const removeSuggestion = useCallback(
    (id: string) => {
      setData((d) => (d ? { ...d, suggestions: d.suggestions.filter((s) => s.id !== id) } : d));
      reload();
    },
    [reload]
  );

  return (
    <SpendingContext.Provider value={{ data, loading, error, reload, setMode, removeSuggestion }}>{children}</SpendingContext.Provider>
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

export function SchedulesPanel() {
  const { data, removeSuggestion } = useSpending();
  if (!data) return <SpendingLoading />;
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? "";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Repeating payments without a schedule</CardTitle>
        <p className="text-xs text-muted-foreground">
          Create makes a monthly scheduled transaction in YNAB with the values on the line. Click a name to edit it first.
        </p>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {data.suggestions.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">Every repeating payment has a schedule.</p>
        )}
        {data.suggestions.map((s) => (
          <SuggestionRow key={s.id} s={s} accountName={accountName(s.accountId)} categories={data.categories} onDone={removeSuggestion} />
        ))}
      </CardContent>
    </Card>
  );
}

export function SpendingSettingsPanel() {
  const { data, reload } = useSpending();
  if (!data) return <SpendingLoading />;
  return <SettingsPanel key={JSON.stringify(data.settings)} data={data} onSaved={reload} />;
}

const ANOMALY_LABEL: Record<Anomaly["kind"], string> = {
  "unusual-charge": "Unusual charge",
  "new-payee": "New payee",
  duplicate: "Possible duplicate",
  "category-spike": "Category over normal",
  "price-increase": "Price went up",
};

/** Unusual things from the last 30 days. Dismiss hides a finding for good (it never writes to YNAB). */
export function AnomaliesPanel() {
  const { data, reload } = useSpending();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  if (!data) return <SpendingLoading />;
  const list = data.anomalies.filter((a) => !hidden.has(a.id));

  const dismiss = async (id: string) => {
    setHidden((h) => new Set(h).add(id));
    setError("");
    try {
      await dismissAnomaly(id);
      reload();
    } catch (e) {
      setHidden((h) => {
        const next = new Set(h);
        next.delete(id);
        return next;
      });
      setError(e instanceof Error ? e.message : "Dismiss failed");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Unusual in the last 30 days</CardTitle>
        <p className="text-xs text-muted-foreground">Things worth a look. Dismiss one when it is fine; it will not come back.</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardHeader>
      <CardContent className="divide-y">
        {list.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Nothing unusual.</p>}
        {list.map((a) => (
          <div key={a.id} className="flex items-start gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{ANOMALY_LABEL[a.kind]}</span>
                <span className="text-xs text-muted-foreground">{formatDate(a.date)}</span>
              </div>
              <p className="mt-0.5 text-sm font-medium" dir="auto">
                {a.title.replace(/^[^:]+: /, "")}
              </p>
              <p className="text-xs text-muted-foreground" dir="auto">
                {a.detail}
              </p>
            </div>
            <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2" onClick={() => dismiss(a.id)}>
              <X className="h-3.5 w-3.5" /> Dismiss
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
