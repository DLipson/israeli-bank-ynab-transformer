import { useCallback, useEffect, useRef, useState } from "react";

/** Loads on mount and when `load` changes. `load` must be a stable function (a module function or useCallback). */
export function useResource<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Each load gets a number; only the newest may write. Unmount takes a number too.
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const result = await load();
      if (mine === latest.current) setData(result);
    } catch (e) {
      if (mine === latest.current) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    const counter = latest;
    void reload();
    return () => {
      counter.current++;
    };
  }, [reload]);

  return { data, loading, error, reload, setData };
}
