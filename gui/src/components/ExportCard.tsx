import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { exportMonths } from "@/api/client";
import { exportRange, lastFullMonth, recentMonths } from "@/lib/export-range";
import { useAsyncAction } from "@/lib/use-async-action";
import { card, label } from "@/lib/rows";
import { monthLabel } from "@/lib/spending";
import { cn } from "@/lib/utils";

const COUNTS = [1, 2, 3, 6, 12, 24];

/** One JSON file with the counted transactions, income and totals of each month in a range. */
export function ExportCard() {
  const now = new Date();
  const currentMonth = recentMonths(now, 1)[0];
  const [end, setEnd] = useState(lastFullMonth(now));
  const [count, setCount] = useState(1);
  const { from, to } = exportRange(end, count);
  const { run, busy, error } = useAsyncAction(() => exportMonths(from, to));
  const monthOptions = recentMonths(now, 36).map((m) => ({ value: m, label: monthLabel(m) + (m === currentMonth ? " (so far)" : "") }));

  return (
    <div className={card}>
      <p className="mb-2 font-medium">Export months (JSON)</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Up to">
          <Select className="mt-1 block" value={end} onChange={setEnd} options={monthOptions} />
        </Field>
        <Field label="Months">
          <Select className="mt-1 block" value={count} onChange={setCount} options={COUNTS.map((n) => ({ value: n, label: String(n) }))} />
        </Field>
        <Button size="sm" variant="outline" onClick={() => void run()} disabled={busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Export
        </Button>
      </div>
      <p className="mt-2 text-sm" data-testid="export-range">
        {from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`}
      </p>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      <p className={cn(label, "mt-2")}>One file with every counted transaction, categories, income and totals per month. The current month is included as partial.</p>
    </div>
  );
}
