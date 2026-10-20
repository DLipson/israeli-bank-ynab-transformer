import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  generateReport,
  getReports,
  getSpending,
  saveSpendingSettings,
  type CategoryOption,
  type CreditLimitGroup,
  type Report,
  type ReportType,
  type SpendingData,
} from "@/api/client";
import { formatDate, K, monthLabel, shekels, SpendingContext, useSpending } from "@/lib/spending";
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

  const reload = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const next = await getSpending();
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

export function SpendingSettingsPanel() {
  const { data, reload } = useSpending();
  if (!data) return <SpendingLoading />;
  return <SettingsPanel key={JSON.stringify(data.settings)} data={data} onSaved={reload} />;
}
