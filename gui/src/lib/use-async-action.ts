import { useCallback, useEffect, useRef, useState } from "react";

/** Wraps a button action: busy while it runs, the error message if it fails. `run` never throws. */
export function useAsyncAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      setBusy(true);
      setError("");
      try {
        return await fn(...args);
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : "Something went wrong");
        return undefined;
      } finally {
        running.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [fn]
  );

  return { run, busy, error, clearError: () => setError("") };
}
