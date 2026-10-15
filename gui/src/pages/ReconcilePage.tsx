import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getReconcile, type AccountReconcile } from "@/api/client";
import { formatDate, K } from "@/lib/spending";

/** Exact to the agora: a reconcile difference of ₪0.40 matters. */
const money = (milli: number) =>
  `${milli < 0 ? "−" : ""}₪${Math.abs(milli / K).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Line({ side, date, amount, payee }: { side: string; date: string; amount: number; payee: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <span className="w-24 shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-center text-[11px] font-medium text-amber-800">{side}</span>
      <span className="w-14 shrink-0 text-xs text-muted-foreground">{formatDate(date)}</span>
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {payee}
      </span>
      <span className="shrink-0 tabular-nums">{money(amount)}</span>
    </div>
  );
}

/** Balance by the scrape alone: last reconciled balance + scraped rows since then, next to YNAB now. */
function Balance({ b }: { b: AccountReconcile["balance"] }) {
  if (b.expected === null) return <p className="mt-1 text-xs text-muted-foreground">Balance by the scrape: — {b.note}</p>;
  const diff = b.ynabBalance - b.expected;
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      Reconciled {formatDate(b.reconciledDate!)}: {money(b.reconciledBalance)} + scrape since ({b.scrapeRows} rows) {money(b.scrapeTotal)} ={" "}
      <span className="font-medium text-foreground">{money(b.expected)}</span> by the scrape · YNAB now {money(b.ynabBalance)}
      {diff !== 0 && <span className="text-amber-700"> · difference {money(diff)}</span>}
    </p>
  );
}

export function ReconcilePage() {
  const [accounts, setAccounts] = useState<AccountReconcile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setAccounts(await getReconcile());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reconcile failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const differences = accounts?.reduce((n, a) => n + a.missingInYnab.length + a.missingInBank.length, 0) ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Bank vs YNAB</CardTitle>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Check again
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Compares your saved scrapes with YNAB. A match is the same account, same amount, and a date up to 3 days apart.
          Only the dates your scrapes cover are checked. To check more days, scrape with more days back.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {accounts && !loading && (
          <p className="text-sm font-medium">{differences === 0 ? "All accounts match." : `${differences} to check.`}</p>
        )}
      </CardHeader>
      <CardContent className="divide-y">
        {!accounts && loading && <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>}
        {accounts?.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">No saved scrapes for mapped accounts. Run a scrape first.</p>
        )}
        {accounts?.map((a) => {
          const ok = a.missingInYnab.length + a.missingInBank.length === 0;
          return (
            <div key={a.source} className="py-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{a.accountName}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(a.from)} – {formatDate(a.to)} · {a.matched} matched
                </span>
                <span className={ok ? "text-xs text-green-700" : "text-xs text-amber-700"}>{ok ? "OK" : "Check"}</span>
              </div>
              {a.missingInYnab.map((b, i) => (
                <Line key={`b${i}`} side="Not in YNAB" date={b.date} amount={b.amount} payee={b.payee} />
              ))}
              {a.missingInBank.map((t) => (
                <Line key={t.id} side="Not in bank" date={t.date} amount={t.amount} payee={t.payee_name ?? ""} />
              ))}
              <Balance b={a.balance} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
