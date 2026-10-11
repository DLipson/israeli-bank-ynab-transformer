import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarPlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createScheduled,
  getSpending,
  ignoreScheduleSuggestion,
  saveSpendingSettings,
  type CategoryOption,
  type CreditLimitGroup,
  type LeftToSpend,
  type ScheduleSuggestion,
  type SpendingData,
  type SpendingSettings,
} from "@/api/client";

const K = 1000;

function shekels(milliunits: number): string {
  const value = Math.round(milliunits / K);
  return `${value < 0 ? "−" : ""}₪${Math.abs(value).toLocaleString("en-US")}`;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IL", { day: "numeric", month: "short" });
}

function monthLabel(yyyyMm: string): string {
  return new Date(`${yyyyMm}-01T00:00:00`).toLocaleDateString("en-IL", { month: "short", year: "numeric" });
}

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

function Headline({ data, onMode }: { data: SpendingData; onMode: (mode: SpendingSettings["mode"]) => void }) {
  const mode = data.settings.mode;
  const main = mode === "cashflow" ? data.cashflow : data.ynab;
  const other = mode === "cashflow" ? data.ynab : data.cashflow;
  const names = { cashflow: "Cash-flow", ynab: "YNAB categories" } as const;
  const otherMode = mode === "cashflow" ? "ynab" : "cashflow";

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Left to spend until {formatDate(data.periodEnd)}</p>
            <p className={cn("text-4xl font-bold tracking-tight", main.total < 0 && "text-red-700")}>{shekels(main.total)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {names[otherMode]}: <span className="font-medium text-foreground">{shekels(other.total)}</span>
            </p>
          </div>
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
                {names[m]}
              </button>
            ))}
          </div>
        </div>

        {data.readyToAssign > 0 && Math.abs(data.gap) > K && (
          <p className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
            The two numbers differ by {shekels(Math.abs(data.gap))}. {shekels(data.readyToAssign)} is in YNAB's Ready to
            Assign: the cash-flow number counts it, the YNAB number does not until you assign it.
          </p>
        )}

        <details>
          <summary className="cursor-pointer text-sm font-medium">How the {names[mode].toLowerCase()} number is built</summary>
          <div className="mt-2">
            <Lines result={main} />
          </div>
        </details>
      </CardContent>
    </Card>
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

  const amountValue = Number(amount);
  const valid = payee.trim() && amountValue > 0 && date;

  return (
    <div className="space-y-2 rounded-md border p-3">
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
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Monthly · {accountName} · seen {s.months} of the last 4 months</span>
        <select
          className="h-7 rounded-md border border-input bg-background px-2 text-xs"
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
        {s.amountVaries && (
          <Badge variant="warning" title="YNAB matches an imported transaction to a scheduled one only when the amount is exactly the same.">
            Amount varies: imports may not match
          </Badge>
        )}
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            disabled={busy || !valid}
            onClick={() =>
              run(() =>
                createScheduled({ accountId: s.accountId, date, amount: Math.round(amountValue * K), payeeName: payee, categoryId: categoryId || null })
              )
            }
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />} Create in YNAB
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => ignoreScheduleSuggestion(s.id))} title="Ignore this suggestion">
            <X className="h-3.5 w-3.5" /> Ignore
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Exposure({ data }: { data: SpendingData }) {
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
            {data.exposure.map((g) => (
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

function Obligations({ data }: { data: SpendingData }) {
  const max = Math.max(...data.obligations.map((o) => o.total), 1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Coming months</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {data.obligations.map((o) => (
          <div key={o.month} className="flex items-center gap-3 text-sm">
            <span className="w-20 shrink-0 text-muted-foreground">{monthLabel(o.month)}</span>
            <div className="h-2 flex-1 rounded bg-muted">
              <div className="h-2 rounded bg-primary/70" style={{ width: `${(o.total / max) * 100}%` }} />
            </div>
            <span className="w-20 text-right font-mono">{shekels(o.total)}</span>
            <span className="hidden w-56 text-xs text-muted-foreground sm:block">
              {shekels(o.scheduled)} scheduled + {shekels(o.installments)} installments
            </span>
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
        overdraft: overdraft.limitAccountId && overdraft.accountId ? overdraft : null,
        creditLimits: groups.filter((g) => g.accountIds.length).map((g) => ({ ...g, name: g.name.trim() || "Cards" })),
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
    <details className="rounded-xl border bg-card p-4">
      <summary className="cursor-pointer text-base font-semibold">Settings</summary>
      <div className="mt-4 space-y-6 text-sm">
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
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <Input value={g.name} onChange={(e) => updateGroup(i, { name: e.target.value })} className="h-8 w-40" aria-label="Group name" />
              <span className="text-muted-foreground">₪</span>
              <Input
                value={String(Math.round(g.limit / K))}
                onChange={(e) => updateGroup(i, { limit: (Number(e.target.value.replace(/\D/g, "")) || 0) * K })}
                inputMode="numeric"
                className="h-8 w-28 text-right"
                aria-label="Limit"
              />
              {cards.map((c) => (
                <label key={c.id} className="flex items-center gap-1">
                  <input type="checkbox" checked={g.accountIds.includes(c.id)} onChange={() => toggleCard(i, c.id)} />
                  {c.name}
                </label>
              ))}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setGroups((x) => x.filter((_, j) => j !== i))} title="Remove group">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
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
      </div>
    </details>
  );
}

export function SpendingPage() {
  const [data, setData] = useState<SpendingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const latest = useRef(0);

  const load = useCallback(async () => {
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
    load();
  }, [load]);

  const setMode = async (mode: SpendingSettings["mode"]) => {
    setData((d) => (d ? { ...d, settings: { ...d.settings, mode } } : d));
    try {
      await saveSpendingSettings({ mode });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the mode");
    }
  };

  const removeSuggestion = (id: string) => {
    setData((d) => (d ? { ...d, suggestions: d.suggestions.filter((s) => s.id !== id) } : d));
    load();
  };

  if (!data) {
    return (
      <div className="flex items-center gap-2 p-4 text-muted-foreground">
        {error ? <span className="text-destructive">{error}</span> : <><Loader2 className="h-4 w-4 animate-spin" /> Loading your numbers from YNAB…</>}
      </div>
    );
  }

  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {data.scheduledCount} scheduled transactions in YNAB · today {formatDate(data.today)}
        </p>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Reload
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Headline data={data} onMode={setMode} />

      {data.suggestions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Suggested scheduled transactions ({data.suggestions.length})</CardTitle>
            <p className="text-xs text-muted-foreground">
              Payments that repeated in your history and have no schedule in YNAB. Check the name, amount, and date, then
              create them. Created ones count as fixed payments.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.suggestions.map((s) => (
              <SuggestionRow key={s.id} s={s} accountName={accountName(s.accountId)} categories={data.categories} onDone={removeSuggestion} />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Exposure data={data} />
        <Obligations data={data} />
      </div>

      <SettingsPanel key={JSON.stringify(data.settings)} data={data} onSaved={load} />
    </div>
  );
}
