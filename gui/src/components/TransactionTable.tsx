import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import type { YnabRow } from "@/api/client";
import { parseChargeDate } from "../../../src/engine/charge-date.js";

interface TransactionTableProps {
  rows: YnabRow[];
}

type SortKey = "date" | "payee" | "outflow" | "inflow";
type SortDir = "asc" | "desc";

function parseMemo(memo: string): Record<string, unknown> | null {
  try {
    return JSON.parse(memo);
  } catch {
    return null;
  }
}

function MemoDisplay({ memo }: { memo: string }) {
  const parsed = parseMemo(memo);
  if (!parsed) return <span className="text-muted-foreground">{memo}</span>;

  const parts: string[] = [];
  const chargeDate = parseChargeDate(memo);
  if (chargeDate) parts.push(`charged: ${chargeDate}`);
  if (parsed.installment) parts.push(`installment: ${parsed.installment as string}`);
  if (parsed.source) parts.push(`source: ${parsed.source as string}`);
  if (parsed.originalAmount) {
    const curr = parsed.originalCurrency || "";
    parts.push(`original: ${curr}${parsed.originalAmount}`);
  }
  if (parsed.category) parts.push(`cat: ${parsed.category as string}`);

  return (
    <span className="text-xs text-muted-foreground">
      {parts.join(" | ") || memo}
    </span>
  );
}

const PAGE_SIZE = 50;

export function TransactionTable({ rows }: TransactionTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "date":
          cmp = a.date.localeCompare(b.date);
          break;
        case "payee":
          cmp = a.payee.localeCompare(b.payee);
          break;
        case "outflow":
          cmp = (parseFloat(a.outflow) || 0) - (parseFloat(b.outflow) || 0);
          break;
        case "inflow":
          cmp = (parseFloat(a.inflow) || 0) - (parseFloat(b.inflow) || 0);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">
        Transactions ({rows.length})
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            {(["date", "payee", "outflow", "inflow"] as SortKey[]).map((key) => (
              <TableHead key={key}>
                <button
                  className="flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort(key)}
                >
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
            ))}
            <TableHead>Memo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map((row, i) => (
            <TableRow key={`${row.date}-${row.payee}-${i}`}>
              <TableCell className="whitespace-nowrap">{row.date}</TableCell>
              <TableCell className="max-w-[200px] truncate">{row.payee}</TableCell>
              <TableCell className="text-right text-red-600">
                {row.outflow || ""}
              </TableCell>
              <TableCell className="text-right text-green-600">
                {row.inflow || ""}
              </TableCell>
              <TableCell className="max-w-[300px]">
                <MemoDisplay memo={row.memo} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
