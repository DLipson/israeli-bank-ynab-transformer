import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPurchases, treatAsRefund, type Purchase, type TxRef } from "@/api/client";
import { link } from "@/lib/rows";
import { formatDate, shekels } from "@/lib/spending";
import { cn } from "@/lib/utils";

const SHOWN = 15;

/**
 * Treat as refund: pick the purchase that an uncategorized money-in entry refunds. Confirm gives
 * the entry the purchase's YNAB category (a YNAB write, only on this click).
 */
export function RefundPicker({ refund, onDone, onCancel }: { refund: TxRef; onDone: () => void; onCancel: () => void }) {
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Purchase | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getPurchases()
      .then(setPurchases)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load purchases"));
  }, []);

  const q = search.trim().toLowerCase();
  // A purchase of the same amount is the likely one, so it comes first; then newest first.
  const list = (purchases ?? [])
    .filter((p) => !q || p.payee.toLowerCase().includes(q) || (p.category ?? "").toLowerCase().includes(q))
    .sort((a, b) => Number(-b.amount === refund.amount) - Number(-a.amount === refund.amount))
    .slice(0, SHOWN);

  const confirm = async () => {
    if (!picked) return;
    setBusy(true);
    setError("");
    try {
      await treatAsRefund(refund.id, picked.id);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  };

  return (
    <div className="my-1.5 rounded-md border bg-muted/30 p-2.5 text-sm">
      {picked ? (
        <>
          <p>
            Set the category of <span dir="auto">“{refund.payee || "No payee"}”</span> to <span className="font-medium">{picked.category}</span>, as a refund of{" "}
            <span dir="auto">{picked.payee}</span> ({formatDate(picked.date)}, {shekels(-picked.amount)}).
          </p>
          <p className="mt-1 text-xs text-muted-foreground">This writes the category to YNAB. It then counts as a refund, not as income.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void confirm()} disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Treat as refund
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPicked(null)} disabled={busy}>
              Back
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Which purchase does this refund? (last 90 days)</span>
            <button type="button" className={link} onClick={onCancel}>
              Cancel
            </button>
          </div>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search payee or category" aria-label="Search purchases" className="h-8" dir="auto" />
          {!purchases && !error && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading purchases…</p>}
          {purchases && list.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No purchase matches.</p>}
          <div className="mt-1">
            {list.map((p) => (
              <button key={p.id} type="button" onClick={() => setPicked(p)} className={cn("flex w-full items-center justify-between gap-2 border-t py-1.5 text-left hover:bg-muted/50")}>
                <span className="min-w-0 text-muted-foreground">
                  <span dir="auto">{p.payee}</span> · {formatDate(p.date)} <span className="text-xs">· {p.category}</span>
                </span>
                <span className="shrink-0">{shekels(-p.amount)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}
