import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveSpendingSettings, type CategoryOption, type CreditLimitGroup, type SpendingData, type SpendingSettings } from "@/api/client";
import { AccountsPage } from "@/pages/AccountsPage";
import { YnabPage } from "@/pages/YnabPage";
import { ReconcilePage } from "@/pages/ReconcilePage";
import { SpendingLoading } from "@/pages/SpendingPage";
import { card, label, link, row } from "@/lib/rows";
import { K, useSpending } from "@/lib/spending";
import { cn } from "@/lib/utils";

/** A setting with its label and one help line under it (spec: no hover-only help). */
function Setting({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <div className={cn(row, "items-start")}>
      <span>
        {title}
        <span className="block text-xs text-muted-foreground">{help}</span>
      </span>
      {children}
    </div>
  );
}

/** A whole-number field that saves on Enter or when it loses focus. */
function NumberField({ value, onSave, aria, prefix, min = 0, max }: { value: number; onSave: (n: number) => void; aria: string; prefix?: string; min?: number; max?: number }) {
  const [text, setText] = useState(String(value));
  return (
    <span className="shrink-0 whitespace-nowrap">
      {prefix}
      <Input
        type="number"
        aria-label={aria}
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Math.min(max ?? Infinity, Math.max(min, Math.round(Number(text) || 0)));
          setText(String(n));
          if (n !== value) onSave(n);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="inline-block h-8 w-24"
      />
    </span>
  );
}

function CardLimits({ data, save }: { data: SpendingData; save: (patch: Partial<SpendingSettings>) => Promise<boolean> }) {
  const [groups, setGroups] = useState<CreditLimitGroup[]>(data.settings.creditLimits);
  const [busy, setBusy] = useState(false);
  const cards = data.accounts.filter((a) => a.type === "creditCard" || a.type === "lineOfCredit");
  const update = (i: number, patch: Partial<CreditLimitGroup>) => setGroups((g) => g.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  /** Default name for a group: its cards' names, e.g. "Leumi Cards + Max Card". */
  const groupName = (g: CreditLimitGroup) => g.accountIds.map((id) => cards.find((c) => c.id === id)?.name).filter(Boolean).join(" + ");
  // A card belongs to one group: ticking it here removes it from the others.
  const toggleCard = (i: number, id: string) =>
    setGroups((g) => g.map((x, j) => (j === i ? { ...x, accountIds: x.accountIds.includes(id) ? x.accountIds.filter((a) => a !== id) : [...x.accountIds, id] } : { ...x, accountIds: x.accountIds.filter((a) => a !== id) })));

  return (
    <div className="space-y-2 pb-2">
      {groups.map((g, i) => (
        <div key={i} className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">Credit limit (₪)</span>
              <Input value={g.limit ? String(Math.round(g.limit / K)) : ""} onChange={(e) => update(i, { limit: (Number(e.target.value.replace(/\D/g, "")) || 0) * K })} inputMode="numeric" placeholder="20000" className="h-8 w-32 text-right" />
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">Name (optional)</span>
              <Input value={g.name} onChange={(e) => update(i, { name: e.target.value })} placeholder={groupName(g) || "Leumi + Max"} className="h-8 w-48" />
            </label>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setGroups((x) => x.filter((_, j) => j !== i))} aria-label="Remove this limit">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
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
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setGroups((g) => [...g, { name: "", limit: 0, accountIds: [] }])}>
          <Plus className="h-3.5 w-3.5" /> Add limit group
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await save({ creditLimits: groups.filter((g) => g.accountIds.length).map((g) => ({ ...g, name: g.name.trim() || groupName(g) })) });
            setBusy(false);
          }}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save card limits
        </Button>
      </div>
    </div>
  );
}

const LINKS = [
  { view: "accounts", text: "Bank accounts and logins" },
  { view: "ynab", text: "YNAB import mapping" },
  { view: "reconcile", text: "Reconcile" },
] as const;

function Main({ data, open }: { data: SpendingData; open: (view: string) => void }) {
  const { reload } = useSpending();
  const s = data.settings;
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [essentials, setEssentials] = useState(() => new Set(s.essentialCategoryIds));
  const [limitsOpen, setLimitsOpen] = useState(false);
  const byGroup = useMemo(() => {
    const map = new Map<string, CategoryOption[]>();
    for (const c of data.categories) map.set(c.group, [...(map.get(c.group) ?? []), c]);
    return [...map];
  }, [data.categories]);

  const save = async (patch: Partial<SpendingSettings>): Promise<boolean> => {
    setMessage(null);
    try {
      await saveSpendingSettings(patch);
      setMessage({ ok: true, text: "Saved. Home and Cards are updating." });
      reload({ quick: true });
      return true;
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
      return false;
    }
  };

  const toggleEssential = (id: string) => {
    const next = new Set(essentials);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setEssentials(next);
    void save({ essentialCategoryIds: [...next] });
  };

  return (
    <div className={card}>
      <p className="mb-2 font-medium">Settings</p>
      {message && <p className={cn("mb-1 text-xs", message.ok ? "text-green-700 dark:text-green-400" : "text-destructive")}>{message.text}</p>}
      <Setting title="Payday" help="“Available until payday” counts until the day before this date.">
        <select
          aria-label="Payday"
          className="h-8 shrink-0 rounded-md border bg-background px-2 text-sm"
          value={String(s.payday)}
          onChange={(e) => void save({ payday: e.target.value === "month-start" ? "month-start" : Number(e.target.value) })}
        >
          <option value="month-start">Month end</option>
          {Array.from({ length: 30 }, (_, i) => i + 2).map((d) => (
            <option key={d} value={d}>
              Day {d}
            </option>
          ))}
        </select>
      </Setting>
      <Setting title="Buffer" help="Money that the app never counts as available.">
        <NumberField aria="Buffer" prefix="₪" value={Math.round(s.buffer / K)} onSave={(n) => void save({ buffer: n * K })} />
      </Setting>
      <Setting title="Compare with the last … months" help="“Normal” spending is the median of this many past months.">
        <NumberField aria="Compare with the last months" min={1} max={24} value={s.baselineMonths} onSave={(n) => void save({ baselineMonths: n })} />
      </Setting>
      <Setting title="Warn when card room is below" help="A card group turns orange below this amount, and red when it is over its limit.">
        <NumberField aria="Warn when card room is below" prefix="₪" value={Math.round(s.cardWarningLevel / K)} onSave={(n) => void save({ cardWarningLevel: n * K })} />
      </Setting>

      <div className="border-t pt-2">
        <p className="text-sm">Everyday essentials</p>
        <p className="mb-1.5 text-xs text-muted-foreground">Categories that you must spend on every week. Only these get a pace and a forecast until payday.</p>
        <div className="grid gap-x-6 gap-y-2 pb-2 sm:grid-cols-2">
          {byGroup.map(([group, list]) => (
            <div key={group}>
              <p className="text-xs font-semibold text-muted-foreground">{group}</p>
              {list.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={essentials.has(c.id)} onChange={() => toggleEssential(c.id)} />
                  <span dir="auto">{c.name}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className={cn(label, "mb-1 mt-3")}>More</p>
      <button type="button" className={cn(row, "w-full text-left hover:bg-muted/50")} onClick={() => setLimitsOpen((o) => !o)} aria-expanded={limitsOpen}>
        <span>
          Card limits <span className="text-xs text-muted-foreground">The limit of each card group.</span>
        </span>
        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", limitsOpen && "rotate-90")} aria-hidden="true" />
      </button>
      {limitsOpen && <CardLimits data={data} save={save} />}
      {LINKS.map((l) => (
        <button key={l.view} type="button" className={cn(row, "w-full text-left hover:bg-muted/50")} onClick={() => open(l.view)}>
          <span>{l.text}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** Settings behind the gear: the spending settings, and links to the setup pages. */
export function SettingsPage({ view, setView }: { view: string; setView: (view: string) => void }) {
  const { data } = useSpending();
  const page = { accounts: <AccountsPage />, ynab: <YnabPage />, reconcile: <ReconcilePage /> }[view];
  if (page) {
    return (
      <div className="space-y-3">
        <button type="button" className={cn(link, "flex items-center gap-1")} onClick={() => setView("main")}>
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Settings
        </button>
        {page}
      </div>
    );
  }
  if (!data) return <SpendingLoading />;
  return <Main key={JSON.stringify(data.settings)} data={data} open={setView} />;
}
