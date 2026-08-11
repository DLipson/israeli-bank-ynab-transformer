import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { ScrapeLogs, type LogEntry } from "@/components/ScrapeLogs";

export interface AccountStatus {
  name: string;
  status: "pending" | "scraping" | "done" | "failed";
  transactionCount?: number;
  error?: string;
}

interface ScrapeProgressProps {
  accounts: AccountStatus[];
  entries: LogEntry[];
}

export function ScrapeProgress({ accounts, entries }: ScrapeProgressProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {accounts.map((account) => (
          <div
            key={account.name}
            className="flex items-center justify-between rounded-md border p-3"
          >
            <div className="flex items-center gap-3">
              {account.status === "scraping" && (
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              )}
              {account.status === "done" && (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
              {account.status === "failed" && (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
              {account.status === "pending" && (
                <div className="h-4 w-4 rounded-full border-2 border-muted" />
              )}
              <span className="text-sm font-medium">{account.name}</span>
            </div>
            <div className="flex items-center gap-2">
              {account.transactionCount !== undefined && (
                <Badge variant="secondary">{account.transactionCount} txns</Badge>
              )}
              {account.error && (
                <Badge variant="destructive">{account.error}</Badge>
              )}
            </div>
          </div>
        ))}
      </div>

      {entries.length > 0 && <ScrapeLogs entries={entries} />}
    </div>
  );
}

