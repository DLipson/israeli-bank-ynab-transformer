import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TxRef } from "@/api/client";
import { formatDate, shekels } from "@/lib/spending";
import { row } from "@/lib/rows";
import { cn } from "@/lib/utils";

/** A row with an arrow; a tap shows the rows behind it. */
export function Expand({ title, amount, open, onToggle, children }: { title: ReactNode; amount: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <button type="button" onClick={onToggle} aria-expanded={open} className={cn(row, "w-full text-left hover:bg-muted/50")}>
        <span className="flex min-w-0 items-center gap-1">
          <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 truncate">{title}</span>
        </span>
        <span className="shrink-0">{amount}</span>
      </button>
      {open && <div className="mb-1 pl-4">{children}</div>}
    </>
  );
}

/** `text` may be Hebrew, so it gets its own direction; the date after it stays left to right. */
export function Line({ text, date, amount, note }: { text: string; date?: string; amount: number; note?: ReactNode }) {
  return (
    <div className={row}>
      <span className="min-w-0 text-muted-foreground">
        <span dir="auto">{text}</span>
        {date && ` · ${formatDate(date)}`}
        {note}
      </span>
      <span className="shrink-0">{shekels(amount)}</span>
    </div>
  );
}

/** `spend`: show money out as a positive amount (a refund is then negative), as spending lists do. */
export function TxLine({ t, note, spend }: { t: TxRef; note?: ReactNode; spend?: boolean }) {
  return <Line text={t.payee || "No payee"} date={t.date} amount={spend ? -t.amount : t.amount} note={note} />;
}

export const Muted = ({ children }: { children: ReactNode }) => <span className="ml-1 text-xs text-muted-foreground">{children}</span>;
