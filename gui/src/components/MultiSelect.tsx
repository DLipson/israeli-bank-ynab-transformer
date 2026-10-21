import { useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Option {
  id: string;
  label: string;
  group?: string;
}

/**
 * Chosen items as removable chips, and a field that opens a list to type in and search. Enter adds
 * the highlighted item; ↑ ↓ move; Esc closes; Backspace in an empty field removes the last chip.
 */
export function MultiSelect({ options, selected, onChange, placeholder, label }: { options: Option[]; selected: string[]; onChange: (ids: string[]) => void; placeholder: string; label: string }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const chosen = selected.map((id) => options.find((o) => o.id === id)).filter((o) => o !== undefined);
  const q = query.trim().toLowerCase();
  const matches = options.filter((o) => !selected.includes(o.id) && (!q || o.label.toLowerCase().includes(q) || (o.group ?? "").toLowerCase().includes(q)));

  const add = (id: string) => {
    onChange([...selected, id]);
    setQuery("");
    setActive(0);
    input.current?.focus();
  };

  return (
    <div className="relative">
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border bg-background px-1.5 py-1" onClick={() => input.current?.focus()}>
        {chosen.map((o) => (
          <span key={o.id} className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-xs">
            <span dir="auto">{o.label}</span>
            <button type="button" aria-label={`Remove ${o.label}`} className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => onChange(selected.filter((id) => id !== o.id))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          className="min-w-32 flex-1 bg-transparent px-1 text-sm outline-none"
          placeholder={chosen.length ? "Add…" : placeholder}
          value={query}
          dir="auto"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && open && matches[active]) {
              e.preventDefault();
              add(matches[active].id);
            } else if (e.key === "Escape") setOpen(false);
            else if (e.key === "Backspace" && !query && selected.length) onChange(selected.slice(0, -1));
          }}
        />
      </div>
      {open && (
        <ul id={listId} role="listbox" className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover py-1 text-sm shadow-md">
          {matches.length === 0 && <li className="px-2.5 py-1.5 text-muted-foreground">No match</li>}
          {matches.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: it runs before the field loses focus and closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                add(o.id);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer justify-between gap-2 px-2.5 py-1.5", i === active && "bg-muted")}
            >
              <span dir="auto">{o.label}</span>
              {o.group && <span className="truncate text-xs text-muted-foreground">{o.group}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
