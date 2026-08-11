export interface LogEntry {
  text: string;
  account?: string;
}

interface ScrapeLogsProps {
  entries: LogEntry[];
}

const GENERAL = "General";

export function ScrapeLogs({ entries }: ScrapeLogsProps) {
  const buckets = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    const key = entry.account ?? GENERAL;
    const list = buckets.get(key) ?? [];
    list.push(entry);
    buckets.set(key, list);
  }
  const keys = [...buckets.keys()];
  const multi = keys.length > 1;

  return (
    <div className={multi ? "grid gap-3 md:grid-cols-2" : "space-y-2"}>
      {keys.map((key) => (
        <div key={key} className="overflow-hidden rounded-md border bg-background">
          <div className="flex items-center justify-between border-b bg-muted px-3 py-1.5">
            <span className="text-xs font-semibold text-muted-foreground">{key}</span>
            <span className="text-[10px] text-muted-foreground">
              {buckets.get(key)!.length} {buckets.get(key)!.length === 1 ? "line" : "lines"}
            </span>
          </div>
          <div className="max-h-40 overflow-y-auto bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
            {buckets.get(key)!.map((entry, i) => (
              <div key={i} className="whitespace-pre-wrap text-muted-foreground">
                {entry.text.trimStart()}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
