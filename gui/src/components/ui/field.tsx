import type { ReactNode } from "react";
import { label as labelStyle } from "@/lib/rows";
import { cn } from "@/lib/utils";

/** A control with its visible label. The label wraps the control, so the label text is the control's accessible name. */
function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block">
        <span className={cn(labelStyle, "block")}>{label}</span>
        {children}
      </label>
      {hint && <p className={cn(labelStyle, "mt-1")}>{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export { Field };
