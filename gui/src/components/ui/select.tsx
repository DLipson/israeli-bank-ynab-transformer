import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface SelectProps<V extends string | number> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "children"> {
  value: V;
  onChange: (value: V) => void;
  // No per-option `disabled`, on purpose: options that grey out other options caused a real bug.
  // A caller that needs fewer choices passes fewer options.
  options: Array<{ value: V; label: string }>;
  /** An empty-value option with this label, always shown, so the user can go back to "nothing chosen". */
  emptyLabel?: string;
}

function Select<V extends string | number>({ value, onChange, options, emptyLabel, className, ...props }: SelectProps<V>) {
  return (
    <select
      className={cn(
        "h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      value={value}
      // The DOM gives a string; hand back the option's own value so a number stays a number.
      onChange={(e) => {
        const option = options.find((o) => String(o.value) === e.target.value);
        if (option) onChange(option.value);
        else if (emptyLabel !== undefined && e.target.value === "") onChange("" as V);
      }}
      {...props}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export { Select };
