import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { getSpending, type SpendingData } from "@/api/client";
import { SpendingContext, useSpending } from "@/lib/spending";
import { readStoredJson, writeStoredJson } from "@/lib/scrape-run";

// --- Shared data for Home, Inbox, Cards, and Settings ---

const CACHE_KEY = "spending.data.v2";

/** Loads the spending numbers once for every tab that shows them; reload() refreshes them. */
export function SpendingProvider({ children }: { children: ReactNode }) {
  // The last numbers show at once; the request (about 10 s) then replaces them.
  const [data, setData] = useState<SpendingData | null>(() => {
    const cached = readStoredJson<SpendingData | null>(CACHE_KEY, null);
    return cached?.available && cached.spentVsIncome ? cached : null;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const latest = useRef(0);

  const reload = useCallback(async (options: { quick?: boolean } = {}) => {
    const request = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const next = await getSpending(options.quick);
      if (request === latest.current) {
        setData(next);
        try {
          writeStoredJson(CACHE_KEY, next);
        } catch {
          // Storage full or blocked: the numbers still show, only the next start is slower.
        }
      }
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
    reload();
  }, [reload]);

  const removeSuggestion = useCallback(
    (id: string) => {
      setData((d) => (d ? { ...d, suggestions: d.suggestions.filter((s) => s.id !== id) } : d));
      reload();
    },
    [reload]
  );

  return (
    <SpendingContext.Provider value={{ data, loading, error, reload, removeSuggestion }}>{children}</SpendingContext.Provider>
  );
}

/** Shown while the spending numbers load, or when loading failed. */
export function SpendingLoading() {
  const { error } = useSpending();
  return (
    <div className="flex items-center gap-2 p-4 text-muted-foreground">
      {error ? <span className="text-destructive">{error}</span> : <><Loader2 className="h-4 w-4 animate-spin" /> Loading your numbers from YNAB…</>}
    </div>
  );
}
