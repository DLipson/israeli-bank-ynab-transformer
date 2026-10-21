import { useEffect, useRef, useState } from "react";
import { Check, CircleCheck, Info, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  acceptCategory,
  createScheduled,
  deleteCreatedScheduled,
  checkAnomaly,
  deleteImported,
  dismissAnomaly,
  importMissing,
  getCategorizeList,
  getLlmSuggestions,
  ignoreScheduleSuggestion,
  restoreAnomaly,
  restoreScheduleSuggestion,
  uncheckAnomaly,
  type CategorizeItem,
  type CategoryOption,
} from "@/api/client";
import { CategoryPicker } from "@/pages/CategorizePage";
import { SpendingLoading } from "@/pages/SpendingPage";
import { ANOMALY_LABEL, buildQueue, type InboxItem } from "@/lib/inbox";
import { formatDate, shekels, useSpending } from "@/lib/spending";

/** One decision, kept in this page's memory so Undo can reverse it. */
interface Done {
  label: string;
  undo: () => Promise<void>;
}

const KIND_NAME = { unusual: "Unusual", missing: "Reconcile", categorize: "Categorize", schedule: "Schedule" } as const;

function ordinal(day: number): string {
  const tens = day % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `${day}${suffix}`;
}

interface Card {
  title: string;
  payee: string;
  amount: number;
  detail: string;
  /** Categorize cards: the suggested category name, or null when there is no suggestion. */
  badge?: string | null;
  /** Categorize cards: why the category is suggested (or the bank text when there is none). */
  why?: string;
  buttons: [string, string];
}

function describe(q: InboxItem): Card {
  if (q.kind === "unusual") {
    const a = q.anomaly;
    return { title: ANOMALY_LABEL[a.kind], payee: a.title.replace(/^[^:]+: /, ""), amount: a.amount, detail: a.detail, buttons: ["Looks right", "Check it"] };
  }
  if (q.kind === "missing") {
    const m = q.missing;
    const ynab = m.side === "not-in-ynab";
    return {
      title: ynab ? "In the bank, not in YNAB" : "In YNAB, not in the bank",
      payee: m.payee || "(no payee)",
      amount: m.amount,
      detail: `${formatDate(m.date)} · ${m.accountName}. ${ynab ? "The bank reported it; YNAB does not have it." : "YNAB has it; the saved scrapes do not."}`,
      buttons: ynab ? ["Import", "Ignore"] : ["Ignore", "Skip"],
    };
  }
  if (q.kind === "categorize") {
    const i = q.item;
    const top = i.suggestions[0];
    return {
      title: "",
      payee: i.merchant || i.payee || "(no payee)",
      amount: i.amount,
      detail: "",
      badge: top ? top.categoryName : null,
      why: top?.note ?? (i.handNote || i.bankText),
      buttons: top ? ["Accept", "Choose another"] : ["Choose a category", "Skip"],
    };
  }
  const s = q.suggestion;
  return {
    title: `Repeats every month on the ${ordinal(s.dayOfMonth)}`,
    payee: s.label,
    amount: s.amount,
    detail: `Seen in ${s.months} of the last 4 months${s.amountVaries ? ". The amount changes, so YNAB may not match it." : ""}`,
    buttons: ["Add schedule", "Not a bill"],
  };
}

/**
 * Inbox: one item at a time. Undo lives in this page's memory: leaving the tab, a reload, or a
 * restart clears it. Accept, Add schedule, and their Undo write to YNAB, always from a click.
 */
export function InboxPage({ onLeft, openList }: { onLeft: (left: number | null) => void; openList: () => void }) {
  const { data, reload } = useSpending();
  const [categorize, setCategorize] = useState<{ items: CategorizeItem[]; categories: CategoryOption[] } | null>(null);
  const [queue, setQueue] = useState<InboxItem[] | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(false);
  // The numbers reload once, 4 s after the last decision, not after every click (YNAB allows 200 calls an hour).
  const reloadTimer = useRef<number | undefined>(undefined);
  const reloadSoon = () => {
    window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => reload(), 4000);
  };
  useEffect(() => () => window.clearTimeout(reloadTimer.current), []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    getCategorizeList()
      .then((list) => {
        setCategorize(list);
        // Big Pickle suggestions arrive later; they fill items in place, so the order stays.
        const llmIds = list.items.filter((i) => i.llm).map((i) => i.id);
        if (llmIds.length) {
          getLlmSuggestions(llmIds)
            .then((found) =>
              setQueue((q) => q?.map((x) => (x.kind === "categorize" && found[x.id] ? { ...x, item: { ...x.item, suggestions: found[x.id] } } : x)) ?? q)
            )
            .catch(() => {
              // Items without a suggestion still offer "Choose a category".
            });
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the transactions to categorize"));
  }, []);

  // The queue is built once, when both lists are here; later reloads do not move items under the user.
  if (!queue && data && categorize) setQueue(buildQueue(data.anomalies, data.missing, categorize.items, data.suggestions));

  const left = queue ? queue.length - done.length : null;
  useEffect(() => {
    onLeft(left);
  }, [left, onLeft]);
  useEffect(() => () => onLeft(null), [onLeft]);

  if (!data || !queue) return error ? <p className="p-4 text-sm text-destructive">{error}</p> : <SpendingLoading />;

  const run = async (label: string, action: () => Promise<(() => Promise<void>) | void>) => {
    setBusy(true);
    setError("");
    try {
      const undo = (await action()) ?? (async () => {});
      setDone((d) => [...d, { label, undo }]);
      setChoosing(false);
      reloadSoon();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  };

  const undoLast = async () => {
    const last = done[done.length - 1];
    setBusy(true);
    setError("");
    try {
      await last.undo();
      setDone((d) => d.slice(0, -1));
      setChoosing(false);
      reloadSoon();
    } catch (e) {
      setError(e instanceof Error ? `Undo failed: ${e.message}` : "Undo failed");
    } finally {
      setBusy(false);
    }
  };

  const undoButton = done.length > 0 && (
    <button type="button" disabled={busy} onClick={() => void undoLast()} className="flex items-center gap-1 text-[13px] text-sky-700 hover:underline disabled:opacity-50 dark:text-sky-400">
      <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Undo: <span dir="auto">{done[done.length - 1].label}</span>
    </button>
  );

  const n = queue.length;
  const i = done.length;
  if (i >= n) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center">
        <CircleCheck className="mx-auto h-7 w-7 text-green-600" aria-hidden="true" />
        <p className="mb-1 mt-2 font-medium">All caught up</p>
        <p className="text-[13px] text-muted-foreground">
          {n} item{n === 1 ? "" : "s"} done. New items appear after the next update.
        </p>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-3 flex justify-center">{undoButton}</div>
      </div>
    );
  }

  const q = queue[i];
  const card = describe(q);
  const name = `${card.buttons[0]} · ${card.payee}`;

  const accept = (category: { id: string; name: string }) =>
    q.kind === "categorize" &&
    run(`Accept ${category.name} · ${card.payee}`, async () => {
      await acceptCategory(q.id, category.id);
      return () => acceptCategory(q.id, null);
    });

  // Ignore: saved with the dismissed anomalies, so the row does not come back.
  const ignore = () =>
    void run(`Ignore · ${card.payee}`, async () => {
      await dismissAnomaly(q.id);
      return () => restoreAnomaly(q.id);
    });

  const first = () => {
    if (q.kind === "missing") {
      if (q.missing.side === "not-in-bank") ignore();
      else
        void run(name, async () => {
          const transactionId = await importMissing(q.id);
          return () => deleteImported(transactionId);
        });
    } else if (q.kind === "unusual") {
      void run(name, async () => {
        await dismissAnomaly(q.id);
        return () => restoreAnomaly(q.id);
      });
    } else if (q.kind === "categorize") {
      const top = q.item.suggestions[0];
      if (top) void accept({ id: top.categoryId, name: top.categoryName });
      else setChoosing(true);
    } else {
      const s = q.suggestion;
      void run(name, async () => {
        const id = await createScheduled({ accountId: s.accountId, date: s.nextDate, amount: s.amount, payeeName: s.label, categoryId: s.categoryId });
        return () => deleteCreatedScheduled(id);
      });
    }
  };

  const second = () => {
    if (q.kind === "missing" && q.missing.side === "not-in-ynab") ignore();
    else if (q.kind === "categorize" && q.item.suggestions.length) setChoosing(true);
    else if (q.kind === "schedule") {
      void run(`${card.buttons[1]} · ${card.payee}`, async () => {
        await ignoreScheduleSuggestion(q.id);
        return () => restoreScheduleSuggestion(q.id);
      });
    } else if (q.kind === "unusual") {
      // Check it: the item leaves the Inbox and stays in Things to watch on Home until marked fine.
      void run(`${card.buttons[1]} · ${card.payee}`, async () => {
        await checkAnomaly(q.anomaly);
        return () => uncheckAnomaly(q.id);
      });
    } else void run(`${card.buttons[1]} · ${card.payee}`, async () => {}); // Skip: nothing to save
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2.5">
        <div className="h-1.5 flex-1 rounded-md bg-muted">
          <div className="h-1.5 rounded-md bg-green-600" style={{ width: `${(i / n) * 100}%` }} />
        </div>
        <span className="text-[13px] text-muted-foreground">
          {i + 1} of {n}
        </span>
      </div>
      <div className="rounded-xl border bg-card px-5 py-6">
        <p className="text-[13px] text-muted-foreground">
          <span className="font-medium">{KIND_NAME[q.kind]}</span>
          {card.title && ` · ${card.title}`}
        </p>
        <p className="mb-0.5 mt-1.5 text-[22px] font-medium" dir="auto">
          {card.payee}
        </p>
        <p className="mb-1.5 text-[22px]">{shekels(Math.abs(card.amount))}</p>
        {card.detail && (
          <p className="text-[13px] text-muted-foreground" dir="auto">
            {card.detail}
          </p>
        )}
        {card.badge !== undefined && (
          <div className="mt-1">
            {card.badge ? (
              <span
                className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-medium text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"
                dir="auto"
              >
                {card.badge}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border px-3 py-1 text-sm text-muted-foreground">No suggestion</span>
            )}
            {card.why && (
              <div className="mt-2 flex gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                <span dir="auto">
                  <span className="font-medium">{card.badge ? "Why:" : "Bank text:"}</span> {card.why}
                </span>
              </div>
            )}
          </div>
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" disabled={busy} onClick={first}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {card.buttons[0]}
          </Button>
          <Button variant="outline" className="flex-1" disabled={busy} onClick={second}>
            {card.buttons[1]}
          </Button>
        </div>
        {card.buttons[1] !== "Skip" && (
          <div className="mt-2 text-right">
            {/* Skip saves nothing: the item comes back the next time the Inbox opens. */}
            <button type="button" className="text-[13px] text-muted-foreground hover:underline disabled:opacity-50" disabled={busy} onClick={() => void run(`Skip · ${card.payee}`, async () => {})}>
              Skip for now
            </button>
          </div>
        )}
        {choosing && categorize && (
          <div className="mt-3">
            <CategoryPicker categories={categorize.categories} disabled={busy} onPick={(c) => void accept(c)} />
          </div>
        )}
      </div>
      <div className="mt-2 flex min-h-5 flex-wrap items-center justify-between gap-2">
        {undoButton || <span />}
        <button type="button" className="text-[13px] text-muted-foreground hover:underline" onClick={openList}>
          All uncategorized as a list
        </button>
      </div>
    </div>
  );
}
