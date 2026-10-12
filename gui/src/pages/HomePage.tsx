import { useState } from "react";
import { CalendarPlus, CheckCircle2, ChevronDown, Clock, CreditCard, Loader2, RefreshCw, Tag } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Pace, SpendingData } from "@/api/client";
import { Exposure, NumberDetails, Obligations, PaceCard, SpendingLoading } from "@/pages/SpendingPage";
import { formatDate, monthLabel, shekels, useSpending } from "@/lib/spending";

export type Navigate = (tab: string, view?: string) => void;

const DAY_MS = 86400000;

const PACE_WORDS: Record<Pace["status"], { text: string; style: string }> = {
  under: { text: "Slower than usual", style: "bg-green-100 text-green-800" },
  on: { text: "About as usual", style: "bg-muted text-muted-foreground" },
  over: { text: "Faster than usual", style: "bg-red-100 text-red-800" },
  "fixed-paid": { text: "As usual", style: "bg-muted text-muted-foreground" },
  "fixed-due": { text: "As usual", style: "bg-muted text-muted-foreground" },
};

interface Attention {
  key: string;
  icon: typeof Clock;
  text: string;
  action: string;
  go: () => void;
}

/** Everything that needs the user's action, in one list; each item links to where it is fixed. */
function attentionItems(data: SpendingData, navigate: Navigate): Attention[] {
  const items: Attention[] = [];
  const age = Math.round((Date.parse(data.today) - Date.parse(data.baseline.asOf)) / DAY_MS);
  if (age >= 3) {
    items.push({ key: "scrape", icon: Clock, text: `Bank data is ${age} days old`, action: "Scrape now", go: () => navigate("scrape") });
  }
  if (data.suggestions.length) {
    const n = data.suggestions.length;
    items.push({
      key: "schedules",
      icon: CalendarPlus,
      text: `${n} repeating payment${n === 1 ? " has" : "s have"} no schedule`,
      action: "Review",
      go: () => navigate("review", "schedules"),
    });
  }
  if (data.uncategorizedCount) {
    const n = data.uncategorizedCount;
    items.push({
      key: "categorize",
      icon: Tag,
      text: `${n} transaction${n === 1 ? " is" : "s are"} not categorized`,
      action: "Review",
      go: () => navigate("review", "categorize"),
    });
  }
  if (data.exposure.some((g) => g.limit === null && g.used > 0)) {
    items.push({ key: "limits", icon: CreditCard, text: "Card limits are not set", action: "Set limits", go: () => navigate("setup", "spending") });
  }
  return items;
}

function NeedsAttention({ data, navigate }: { data: SpendingData; navigate: Navigate }) {
  const items = attentionItems(data, navigate);
  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-1 text-sm font-semibold">Needs attention</p>
        {items.length === 0 && (
          <p className="flex items-center gap-2 py-2 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4" /> Nothing needs your attention.
          </p>
        )}
        {items.map(({ key, icon: Icon, text, action, go }) => (
          <button
            key={key}
            onClick={go}
            className="flex w-full items-center gap-2 border-t py-2 text-left text-sm first-of-type:border-t-0 hover:bg-muted/50"
          >
            <Icon className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span className="flex-1">{text}</span>
            <span className="text-primary underline-offset-4 hover:underline">{action} →</span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function Summaries({ data }: { data: SpendingData }) {
  const limited = data.exposure.filter((g) => g.limit !== null);
  const unused = limited.reduce((s, g) => s + (g.unused ?? 0), 0);
  const total = limited.reduce((s, g) => s + (g.limit ?? 0), 0);
  const months = data.obligations.slice(0, 3);
  const max = Math.max(...months.map((m) => m.total), 1);
  const card = "rounded-xl border bg-card p-4";

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className={card}>
        <p className="mb-1.5 text-xs text-muted-foreground">Most over pace</p>
        {data.baseline.topOver.length === 0 && <p className="text-sm text-muted-foreground">Nothing over pace</p>}
        {data.baseline.topOver.map((p) => (
          <p key={p.name} className="flex justify-between gap-2 text-sm">
            <span className="truncate" dir="auto">
              {p.name}
            </span>
            <span className="shrink-0 text-red-700">
              {p.difference === null ? shekels(p.thisMonth) : `+${Math.round(p.difference * 100)}%`}
            </span>
          </p>
        ))}
      </div>
      {limited.length > 0 && (
        <div className={card}>
          <p className="mb-1.5 text-xs text-muted-foreground">Credit unused</p>
          <p className={cn("text-2xl font-semibold", unused < 0 && "text-red-700")}>{shekels(unused)}</p>
          <p className="text-xs text-muted-foreground">of {shekels(total)} in limits</p>
        </div>
      )}
      <div className={card}>
        <p className="mb-2 text-xs text-muted-foreground">Next 3 months</p>
        {months.map((m) => (
          <div key={m.month} className="mt-1 flex items-center gap-2 text-xs" title={`${shekels(m.scheduled)} scheduled + ${shekels(m.installments)} installments`}>
            <span className="w-8 shrink-0">{monthLabel(m.month).split(" ")[0]}</span>
            <span className="h-1.5 flex-1 rounded bg-muted">
              <span className="block h-1.5 rounded bg-primary/70" style={{ width: `${(m.total / max) * 100}%` }} />
            </span>
            <span className="w-16 shrink-0 text-right font-mono">{shekels(m.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HomePage({ navigate }: { navigate: Navigate }) {
  const { data, loading, reload, setMode } = useSpending();
  const [details, setDetails] = useState(false);
  if (!data) return <SpendingLoading />;

  const mode = data.settings.mode;
  const main = mode === "cashflow" ? data.cashflow : data.ynab;
  const label =
    mode === "ynab"
      ? `Available in your flexible YNAB categories`
      : `Left to spend until ${formatDate(data.periodEnd)}${data.settings.subtractExpected ? ", after your usual spending" : ""}`;
  const pace = data.baseline.total;
  const words = PACE_WORDS[pace.status];

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-2 p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-muted-foreground">{label}</p>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={reload} disabled={loading} aria-label="Reload numbers">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className={cn("text-4xl font-bold tracking-tight", main.total < 0 && "text-red-700")}>{shekels(main.total)}</p>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn("rounded px-2 py-0.5 text-xs font-medium", words.style)}>{words.text}</span>
            <span className="text-muted-foreground">
              {shekels(pace.thisMonth)} spent so far vs. {shekels(pace.normalByToday)} normal
            </span>
          </p>
          <button
            className="flex items-center gap-1 pt-1 text-sm text-primary underline-offset-4 hover:underline"
            onClick={() => setDetails((d) => !d)}
            aria-expanded={details}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", details && "rotate-180")} /> {details ? "Hide details" : "Details"}
          </button>
          {details && (
            <div className="border-t pt-3">
              <NumberDetails data={data} onMode={setMode} />
            </div>
          )}
        </CardContent>
      </Card>

      <NeedsAttention data={data} navigate={navigate} />
      <Summaries data={data} />

      {details && (
        <div className="space-y-3">
          <PaceCard data={data} />
          <div className="grid gap-3 lg:grid-cols-2">
            <Exposure data={data} />
            <Obligations data={data} />
          </div>
        </div>
      )}
    </div>
  );
}
