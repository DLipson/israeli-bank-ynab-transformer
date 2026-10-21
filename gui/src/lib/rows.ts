import { useState } from "react";

export const card = "rounded-xl border bg-card px-5 py-4";
export const label = "text-[13px] text-muted-foreground";
export const row = "flex items-center justify-between gap-2 border-t py-1.5 text-sm";
export const link = "text-[13px] text-sky-700 hover:underline dark:text-sky-400";

/** Open/closed state for many Expand rows, by key. */
export function useOpen(initial: string[] = []) {
  const [open, setOpen] = useState(() => new Set(initial));
  return {
    is: (key: string) => open.has(key),
    toggle: (key: string) =>
      setOpen((s) => {
        const next = new Set(s);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    add: (key: string) => setOpen((s) => new Set(s).add(key)),
  };
}
