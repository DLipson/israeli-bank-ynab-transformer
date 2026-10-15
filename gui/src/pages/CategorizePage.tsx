import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  acceptCategory,
  getCategorizeList,
  getLlmSuggestions,
  rejectCategory,
  saveSearchKey,
  type CategorizeItem,
  type CategoryOption,
  type CategorySuggestion,
  type Evidence,
} from "@/api/client";

const EVIDENCE_LABEL: Record<Evidence, string> = {
  history: "Your history",
  sector: "Card sector",
  name: "Business name",
  memo: "Memo",
  web: "Web search",
};

const EVIDENCE_STYLE: Record<Evidence, string> = {
  history: "bg-blue-100 text-blue-800",
  sector: "bg-purple-100 text-purple-800",
  name: "bg-amber-100 text-amber-800",
  memo: "bg-amber-100 text-amber-800",
  web: "bg-teal-100 text-teal-800",
};

function formatAmount(milliunits: number): string {
  const value = milliunits / 1000;
  return `${value < 0 ? "−" : "+"}₪${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IL", { day: "numeric", month: "short" });
}

type Status = { done?: string; busy?: boolean; error?: string };

function SuggestionRow({
  suggestion,
  primary,
  disabled,
  onAccept,
  onReject,
}: {
  suggestion: CategorySuggestion;
  primary: boolean;
  disabled: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-2">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{suggestion.categoryName}</span>
          <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", EVIDENCE_STYLE[suggestion.evidence])}>
            {EVIDENCE_LABEL[suggestion.evidence]}
          </span>
        </div>
        <p className="text-xs text-muted-foreground" dir="auto">
          {suggestion.note}
          {suggestion.source && (
            <a
              href={suggestion.source}
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              source <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant={primary ? "default" : "outline"} disabled={disabled} onClick={onAccept}>
          <Check className="h-3.5 w-3.5" /> Accept
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onReject} title="Reject this suggestion">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function CategoryPicker({
  categories,
  disabled,
  onPick,
}: {
  categories: CategoryOption[];
  disabled: boolean;
  onPick: (category: CategoryOption) => void;
}) {
  const groups = useMemo(() => {
    const byGroup = new Map<string, CategoryOption[]>();
    for (const c of categories) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
    return [...byGroup.entries()];
  }, [categories]);

  return (
    <select
      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground"
      value=""
      disabled={disabled}
      onChange={(e) => {
        const category = categories.find((c) => c.id === e.target.value);
        if (category) onPick(category);
      }}
    >
      <option value="">Pick another category…</option>
      {groups.map(([group, list]) => (
        <optgroup key={group} label={group}>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ItemCard({
  item,
  status,
  asking,
  focused,
  categories,
  onFocus,
  onAccept,
  onReject,
}: {
  item: CategorizeItem;
  status: Status;
  asking: boolean;
  focused: boolean;
  categories: CategoryOption[];
  onFocus: () => void;
  onAccept: (category: { id: string; name: string }) => void;
  onReject: (categoryId: string) => void;
}) {
  const detail = item.handNote || item.bankText;
  return (
    <Card
      className={cn("transition-shadow", focused && "ring-2 ring-primary")}
      // Select the card on a click in its empty area; buttons, links, and the dropdown keep their own focus.
      onClick={(e) => !(e.target as HTMLElement).closest("button, select, a, input") && onFocus()}
      aria-current={focused || undefined}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium" dir="auto">
              {item.merchant || item.payee || "(no payee)"}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDate(item.date)} · {item.account}
              {item.sector && (
                <>
                  {" · "}
                  <span dir="auto">{item.sector}</span>
                </>
              )}
            </p>
          </div>
          <span className={cn("shrink-0 font-mono text-sm", item.amount < 0 ? "text-red-700" : "text-green-700")}>
            {formatAmount(item.amount)}
          </span>
        </div>

        {detail && (
          <p className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground" dir="auto">
            {detail}
          </p>
        )}

        {status.error && <p className="text-xs text-destructive">{status.error}</p>}

        {asking && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking Big Pickle…
          </p>
        )}

        <div className="space-y-2">
          {item.suggestions.map((s, i) => (
            <SuggestionRow
              key={s.categoryId}
              suggestion={s}
              primary={i === 0}
              disabled={Boolean(status.busy)}
              onAccept={() => onAccept({ id: s.categoryId, name: s.categoryName })}
              onReject={() => onReject(s.categoryId)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <CategoryPicker categories={categories} disabled={Boolean(status.busy)} onPick={onAccept} />
          {status.busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </CardContent>
    </Card>
  );
}

function SearchKeyForm({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-xs"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await saveSearchKey(key);
          setKey("");
          onSaved();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Save failed");
        }
      }}
    >
      <span className="text-muted-foreground">Web search is off. Serper API key:</span>
      <Input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        className="h-8 w-64"
        autoComplete="off"
      />
      <Button size="sm" variant="outline" type="submit" disabled={!key.trim()}>
        Save
      </Button>
      {error && <span className="text-destructive">{error}</span>}
    </form>
  );
}

const DEFAULT_DAYS = 31;
const DAYS_STORAGE_KEY = "categorize-days";

function parseDays(value: string): number | null {
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
}

function storedDays(): number {
  try {
    return parseDays(localStorage.getItem(DAYS_STORAGE_KEY) ?? "") ?? DEFAULT_DAYS;
  } catch {
    return DEFAULT_DAYS;
  }
}

/**
 * The day count, edited in place inside the title. It applies on Enter or when the field loses
 * focus (each change reloads the list). Esc or an invalid value goes back to the last valid value.
 */
function DaysInput({ value, onCommit }: { value: number; onCommit: (days: number) => void }) {
  // The parent remounts this with key={value}, so the draft starts from the current value.
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    const days = parseDays(draft);
    if (days === null) setDraft(String(value));
    else if (days !== value) onCommit(days);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label="Number of days to look back (1 to 365)"
      title="Click to change (1 to 365 days)"
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 3))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(String(value));
          requestAnimationFrame(() => e.currentTarget?.blur());
        }
      }}
      onFocus={(e) => e.currentTarget.select()}
      style={{ width: `${Math.max(draft.length, 2) + 1}ch` }}
      className="mx-1 rounded-sm border-b border-dotted border-foreground/60 bg-transparent text-center font-semibold outline-none transition-colors hover:border-solid hover:bg-muted focus:border-solid focus:border-primary focus:bg-muted"
    />
  );
}

export function CategorizePage() {
  const [days, setDays] = useState(storedDays);
  const latestRequest = useRef(0);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [items, setItems] = useState<CategorizeItem[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [searchKeySaved, setSearchKeySaved] = useState(true);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [asking, setAsking] = useState<Set<string>>(new Set());
  const [llmError, setLlmError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [focusId, setFocusId] = useState("");

  // sync: ask YNAB for changes (first open, Reload). A change of days only filters again on the server.
  const load = useCallback(async (lookBack: number, sync = true) => {
    // Only the newest request may update the page, if the days change while a load is running.
    const request = ++latestRequest.current;
    setLoading(true);
    setError("");
    setLlmError("");
    try {
      const data = await getCategorizeList(lookBack, sync);
      if (request !== latestRequest.current) return;
      setItems(data.items);
      setCategories(data.categories);
      setSearchKeySaved(data.searchKeySaved);
      setStatus({});
      const llmIds = data.items.filter((i) => i.llm).map((i) => i.id);
      if (llmIds.length) {
        setAsking(new Set(llmIds));
        getLlmSuggestions(llmIds)
          .then((found) => {
            if (request !== latestRequest.current) return;
            setItems((current) => current.map((i) => (found[i.id] ? { ...i, suggestions: found[i.id] } : i)));
          })
          .catch((e) => {
            if (request === latestRequest.current) setLlmError(e instanceof Error ? e.message : "The LLM step failed.");
          })
          .finally(() => {
            if (request === latestRequest.current) setAsking(new Set());
          });
      } else {
        setAsking(new Set());
      }
    } catch (e) {
      if (request === latestRequest.current) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (request === latestRequest.current) {
        setLoading(false);
        setLoadedOnce(true);
      }
    }
  }, []);

  const changeDays = (next: number) => {
    setDays(next);
    try {
      localStorage.setItem(DAYS_STORAGE_KEY, String(next));
    } catch {
      // Remembering the value is a convenience only.
    }
    load(next, false);
  };

  // First load only; later loads come from the days field and the Reload button.
  // React development mode runs effects twice; without this guard the page synced with YNAB twice.
  const initialDays = useRef(days);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    load(initialDays.current);
  }, [load]);

  const open = items.filter((i) => !status[i.id]?.done);
  const suggested = open.filter((i) => i.suggestions.length > 0 || asking.has(i.id));
  const unsuggested = open.filter((i) => i.suggestions.length === 0 && !asking.has(i.id));
  const done = items.filter((i) => status[i.id]?.done);
  // Bulk accept only strong history with a useful sample: at least 3 uses and 80% agreement.
  const historyOnly = suggested.filter(
    (i) =>
      i.suggestions.length === 1 &&
      i.suggestions[0].evidence === "history" &&
      (i.suggestions[0].sampleSize ?? 0) >= 3 &&
      (i.suggestions[0].share ?? 0) >= 0.8
  );

  const setItemStatus = (id: string, next: Status) => setStatus((s) => ({ ...s, [id]: next }));

  // Ids with an accept in progress, so a repeated key or click cannot send the same write twice.
  const accepting = useRef(new Set<string>());

  const accept = useCallback(async (item: CategorizeItem, category: { id: string; name: string }) => {
    if (accepting.current.has(item.id)) return;
    accepting.current.add(item.id);
    setItemStatus(item.id, { busy: true });
    try {
      await acceptCategory(item.id, category.id);
      setItemStatus(item.id, { done: category.name });
    } catch (e) {
      setItemStatus(item.id, { error: e instanceof Error ? e.message : "Accept failed" });
    } finally {
      accepting.current.delete(item.id);
    }
  }, []);

  const reject = useCallback(async (item: CategorizeItem, categoryId: string) => {
    setItemStatus(item.id, { busy: true });
    try {
      await rejectCategory(item.id, categoryId);
      setItems((current) =>
        current.map((i) =>
          i.id === item.id ? { ...i, suggestions: i.suggestions.filter((s) => s.categoryId !== categoryId) } : i
        )
      );
      setItemStatus(item.id, {});
    } catch (e) {
      setItemStatus(item.id, { error: e instanceof Error ? e.message : "Reject failed" });
    }
  }, []);

  const acceptAllHistory = async () => {
    for (const item of historyOnly) {
      const s = item.suggestions[0];
      await accept(item, { id: s.categoryId, name: s.categoryName });
    }
  };

  const focusCard = (id: string | undefined) => {
    if (id) document.getElementById(`cat-${id}`)?.focus();
  };

  // Keyboard shortcuts act only on the card that has keyboard focus, never on the page as a whole,
  // so a stray Enter elsewhere cannot write to YNAB. ↑/↓ move, Enter accepts the top suggestion, X rejects it.
  const onCardKey = (e: React.KeyboardEvent<HTMLDivElement>, item: CategorizeItem, list: CategorizeItem[]) => {
    if (e.target !== e.currentTarget) return;
    const index = list.findIndex((i) => i.id === item.id);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusCard(list[index + (e.key === "ArrowDown" ? 1 : -1)]?.id);
    } else if (e.key === "Enter" && item.suggestions.length && !status[item.id]?.busy) {
      e.preventDefault();
      const s = item.suggestions[0];
      focusCard(list[index + 1]?.id ?? list[index - 1]?.id);
      accept(item, { id: s.categoryId, name: s.categoryName });
    } else if (e.key.toLowerCase() === "x" && item.suggestions.length && !status[item.id]?.busy) {
      e.preventDefault();
      reject(item, item.suggestions[0].categoryId);
    }
  };


  if (loading && !loadedOnce) {
    return (
      <div className="flex items-center gap-2 p-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading uncategorized transactions from YNAB…
      </div>
    );
  }

  const renderCard = (item: CategorizeItem, _index: number, list: CategorizeItem[]) => (
    <div
      key={item.id}
      id={`cat-${item.id}`}
      tabIndex={0}
      className="rounded-xl outline-none"
      aria-label={`${item.merchant || item.payee}, ${item.suggestions.length} suggestions`}
      onFocus={(e) => e.target === e.currentTarget && setFocusId(item.id)}
      onBlur={(e) => e.target === e.currentTarget && setFocusId("")}
      onKeyDown={(e) => onCardKey(e, item, list)}
    >
      <ItemCard
        item={item}
        status={status[item.id] ?? {}}
        asking={asking.has(item.id)}
        focused={item.id === focusId}
        categories={categories}
        onFocus={() => focusCard(item.id)}
        onAccept={(category) => accept(item, category)}
        onReject={(categoryId) => reject(item, categoryId)}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center text-base">
            Uncategorized transactions, last
            <DaysInput key={days} value={days} onCommit={changeDays} />
            days
            {loading && <Loader2 className="ml-2 h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{suggested.length} with suggestions</Badge>
            <Badge variant="outline">{unsuggested.length} no suggestion</Badge>
            <Badge variant="success">{done.length} done</Badge>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => load(days)} disabled={loading}>
                Reload
              </Button>
              <Button size="sm" disabled={historyOnly.length === 0} onClick={acceptAllHistory}>
                Accept all strong history ({historyOnly.length})
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Keyboard: click a card (or Tab to it) to select it. Then ↑ ↓ move, Enter accepts the top suggestion, X
            rejects it. Accept writes the category to YNAB.
          </p>
          {!searchKeySaved && <SearchKeyForm onSaved={() => setSearchKeySaved(true)} />}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {llmError && <p className="text-sm text-destructive">Big Pickle: {llmError}</p>}
        </CardContent>
      </Card>

      {!error && items.length === 0 && (
        <p className="p-4 text-center text-muted-foreground">No uncategorized transactions in the last {days} days.</p>
      )}

      {suggested.length > 0 && <div className="space-y-3">{suggested.map(renderCard)}</div>}

      {unsuggested.length > 0 && (
        <details className="rounded-md border p-3" open={suggested.length === 0}>
          <summary className="cursor-pointer text-sm font-medium">
            No suggestion ({unsuggested.length}) — not enough evidence to suggest a category
          </summary>
          <div className="mt-3 space-y-3">{unsuggested.map(renderCard)}</div>
        </details>
      )}

      {done.length > 0 && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">Done ({done.length})</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {done.map((i) => (
              <li key={i.id} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-700" />
                <span dir="auto">{i.merchant || i.payee}</span>
                <span className="text-muted-foreground">→ {status[i.id]?.done}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
