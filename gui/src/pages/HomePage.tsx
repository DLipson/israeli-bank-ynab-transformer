import { useState } from "react";
import { CreditCard, Loader2, Pencil, TrendingUp } from "lucide-react";
import { Expand, Line, Muted, TxLine } from "@/components/Rows";
import { card, label, row, useOpen } from "@/lib/rows";
import { saveSpendingSettings, type CategoryComparison, type SpendingData } from "@/api/client";
import { SpendingLoading } from "@/pages/SpendingPage";
import { K, formatDate, nextEssentialsOverride, shekels, useSpending } from "@/lib/spending";
import { cn } from "@/lib/utils";

export type Navigate = (tab: string, view?: string) => void;

function monthName(yyyyMm: string): string {
  return new Date(`${yyyyMm}-01T00:00:00`).toLocaleDateString("en-IL", { month: "long" });
}


const COMPARE_WORD: Record<CategoryComparison["type"], string> = { occasional: "avg", essential: "normal by this day", fixed: "" };

function SpentVsIncomeCard({ data, navigate, open }: { data: SpendingData; navigate: Navigate; open: ReturnType<typeof useOpen> }) {
  const s = data.spentVsIncome;
  const month = monthName(s.month);
  const over = s.difference < 0;
  const max = Math.max(s.spent, s.income, 1);
  const grey = (Math.min(s.spent, s.income) / max) * 100;
  const red = (Math.max(0, s.spent - s.income) / max) * 100;
  const days = s.daysLeft === 1 ? "1 day left" : `${s.daysLeft} days left`;

  return (
    <div className={card}>
      <p className={label}>{month} · spent vs income counted</p>
      <p className="mb-0.5 mt-1 text-[28px] font-medium">
        {shekels(s.spent)} <span className="text-base font-normal text-muted-foreground">of {shekels(s.income)}</span>
      </p>
      <button
        type="button"
        aria-label="See income and spending"
        onClick={() => open.toggle("bar")}
        className="mb-1.5 mt-2.5 flex h-3.5 w-full overflow-hidden rounded-md bg-muted"
      >
        <span className="h-full bg-muted-foreground" style={{ width: `${grey}%` }} />
        <span className="h-full bg-red-500" style={{ width: `${red}%` }} />
      </button>
      <p className={cn("text-sm", over ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}>
        {shekels(Math.abs(s.difference))} {over ? "more" : "less"} than you earned · {days}
      </p>

      {open.is("bar") ? (
        <div className="mt-3">
          <p className={cn(label, "mb-1")}>Income counted</p>
          {s.incomeParts.map((part) => (
            <Expand key={part.label} title={<span dir="auto">{part.label}</span>} amount={shekels(part.amount)} open={open.is(`inc:${part.label}`)} onToggle={() => open.toggle(`inc:${part.label}`)}>
              {part.items.map((t) => (
                <TxLine
                  key={t.id}
                  t={t}
                  note={
                    <>
                      {!t.date.startsWith(s.month) && <Muted>(counts toward {month})</Muted>}
                      {t.oneTime && <Muted>· one-time</Muted>}
                    </>
                  }
                />
              ))}
            </Expand>
          ))}
          {s.incomeParts.length === 0 && <p className="border-t py-1.5 text-sm text-muted-foreground">No income counted yet.</p>}

          {s.reasons.length > 0 && <p className={cn(label, "mb-1 mt-3")}>{over ? "What pushed you over" : "Above normal this month"}</p>}
          {s.reasons.map((r) => (
            <Expand
              key={r.categoryId}
              title={
                <>
                  <span dir="auto">{r.name}</span> <Muted>· {r.type}</Muted>
                </>
              }
              amount={
                <>
                  {shekels(r.thisMonth)} <Muted>vs {shekels(r.compareTo)}{COMPARE_WORD[r.type] && ` ${COMPARE_WORD[r.type]}`}</Muted>
                </>
              }
              open={open.is(`cat:${r.categoryId}`)}
              onToggle={() => open.toggle(`cat:${r.categoryId}`)}
            >
              {r.items.map((t) => (
                <TxLine key={t.id} t={t} spend />
              ))}
            </Expand>
          ))}

          {s.uncategorized.count > 0 && (
            <Expand title="Not categorized yet" amount={shekels(s.uncategorized.amount)} open={open.is("uncat")} onToggle={() => open.toggle("uncat")}>
              <div className={row}>
                <span className={label}>
                  {s.uncategorized.count} transaction{s.uncategorized.count === 1 ? "" : "s"}
                </span>
                <button type="button" className="text-[13px] text-sky-700 hover:underline dark:text-sky-400" onClick={() => navigate("inbox", "categorize")}>
                  Categorize in Inbox
                </button>
              </div>
            </Expand>
          )}

          {s.savedThisMonth.amount > 0 && (
            <Expand title="Moved to savings" amount={shekels(s.savedThisMonth.amount)} open={open.is("saved")} onToggle={() => open.toggle("saved")}>
              {s.savedThisMonth.items.map((t) => (
                <TxLine key={t.id} t={t} spend />
              ))}
            </Expand>
          )}

          <Expand
            title={
              <>
                All spending <Muted>· 1–{Number(data.today.slice(8, 10))} {month.slice(0, 3)}</Muted>
              </>
            }
            amount={shekels(s.spent)}
            open={open.is("all")}
            onToggle={() => open.toggle("all")}
          >
            {s.spendingItems.map((t) => (
              <TxLine key={t.id} t={t} spend note={t.category && <Muted>· {t.category}</Muted>} />
            ))}
          </Expand>
        </div>
      ) : (
        <button type="button" className="mt-2 text-[13px] text-sky-700 hover:underline dark:text-sky-400" onClick={() => open.toggle("bar")}>
          See income and spending
        </button>
      )}
      <div className="mt-2">
        <button type="button" className="text-[13px] text-sky-700 hover:underline dark:text-sky-400" onClick={() => navigate("reports")}>
          Last month's report
        </button>
      </div>
    </div>
  );
}

const LINE_LABEL = {
  cash: "Cash",
  cards: "Card charges, already spent",
  bills: "Bills still to come",
  essentials: "Everyday essentials still to come",
  buffer: "Buffer",
} as const;

/** A shekel amount that saves on Enter or when the field loses focus. */
function MoneyInput({ value, step, onSave, label: aria }: { value: number; step: number; onSave: (milliunits: number) => void; label: string }) {
  const [text, setText] = useState(String(Math.round(value / K)));
  const save = () => {
    const shekel = Math.max(0, Number(text) || 0);
    setText(String(shekel));
    if (shekel * K !== Math.round(value / K) * K) onSave(shekel * K);
  };
  return (
    <span className="whitespace-nowrap">
      −₪
      <input
        type="number"
        min={0}
        step={step}
        aria-label={aria}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="h-7 w-20 rounded-md border bg-background px-1.5 text-sm"
      />
    </span>
  );
}

function AvailableCard({ data, navigate }: { data: SpendingData; navigate: Navigate }) {
  const { reload } = useSpending();
  const open = useOpen();
  const a = data.available;
  const [edits, setEdits] = useState<{ buffer?: number; essentials: Record<string, number> }>({ essentials: {} });
  const [editingBuffer, setEditingBuffer] = useState(false);
  const [error, setError] = useState("");

  // Show an edit at once; the saved numbers come back with the reload.
  const lines = a.lines.map((line) => {
    if (line.key === "buffer" && edits.buffer !== undefined) return { ...line, amount: -edits.buffer };
    if (line.key !== "essentials") return line;
    const items = line.items.map((i) => (i.categoryId && i.categoryId in edits.essentials ? { ...i, amount: -edits.essentials[i.categoryId] } : i));
    return { ...line, items, amount: items.reduce((sum, i) => sum + i.amount, 0) };
  });
  const total = lines.reduce((sum, l) => sum + l.amount, 0);

  const save = async (patch: Parameters<typeof saveSpendingSettings>[0]) => {
    setError("");
    try {
      await saveSpendingSettings(patch);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  };

  return (
    <div className={card}>
      <p className={label}>Money available until payday ({formatDate(a.periodEnd)})</p>
      <p className={cn("mb-2 mt-1 text-[22px] font-medium", total < 0 && "text-red-700 dark:text-red-400")}>{shekels(total)}</p>
      {error && <p className="mb-1 text-xs text-destructive">{error}</p>}
      {lines.map((line) => {
        if (line.key === "buffer") {
          return (
            <div key="buffer" className={row}>
              <span className="text-muted-foreground">{LINE_LABEL.buffer}</span>
              {editingBuffer ? (
                <MoneyInput
                  label="Buffer"
                  step={100}
                  value={-line.amount}
                  onSave={(buffer) => {
                    setEdits((e) => ({ ...e, buffer }));
                    setEditingBuffer(false);
                    void save({ buffer });
                  }}
                />
              ) : (
                <button type="button" onClick={() => setEditingBuffer(true)} className="flex items-center gap-1 hover:underline" aria-label="Edit buffer">
                  {shekels(line.amount)} <Pencil className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        }
        if (line.key === "essentials" && a.essentialsNotChosen) {
          return (
            <div key="essentials" className={row}>
              <span className="text-muted-foreground">{LINE_LABEL.essentials}</span>
              <span className="flex items-center gap-3">
                <button type="button" className="text-[13px] text-sky-700 hover:underline dark:text-sky-400" onClick={() => navigate("settings", "spending")}>
                  Choose your everyday essentials
                </button>
                {shekels(0)}
              </span>
            </div>
          );
        }
        return (
          <Expand key={line.key} title={LINE_LABEL[line.key]} amount={shekels(line.amount)} open={open.is(line.key)} onToggle={() => open.toggle(line.key)}>
            {line.key === "essentials" ? (
              <>
                {line.items.map((i) => (
                  <div key={i.categoryId} className={row}>
                    <span className="min-w-0 text-muted-foreground">
                      <span dir="auto">{i.label}</span>
                      <Muted>{i.assigned !== undefined ? `assigned ${shekels(i.assigned)} − spent` : "normal"}</Muted>
                    </span>
                    <MoneyInput
                      label={`${i.label} still to come`}
                      step={50}
                      value={-i.amount}
                      onSave={(amount) => {
                        setEdits((e) => ({ ...e, essentials: { ...e.essentials, [i.categoryId!]: amount } }));
                        void save({ essentialsOverride: nextEssentialsOverride(data.settings.essentialsOverride, a.periodEnd, i.categoryId!, amount) });
                      }}
                    />
                  </div>
                ))}
                <p className="my-1.5 text-xs text-muted-foreground">Edits apply to this period only.</p>
              </>
            ) : (
              line.items.map((i, n) => <Line key={`${i.label}-${i.date ?? n}`} text={i.label} date={i.date} amount={i.amount} />)
            )}
            {line.items.length === 0 && <p className="border-t py-1.5 text-sm text-muted-foreground">Nothing here.</p>}
          </Expand>
        );
      })}
      {a.warnings.map((w) => (
        <p key={w} className="mt-1.5 text-xs text-muted-foreground">
          {w}
        </p>
      ))}
    </div>
  );
}

function WatchCard({ data, navigate, openCategory }: { data: SpendingData; navigate: Navigate; openCategory: (id: string) => void }) {
  if (data.watch.length === 0) return null;
  return (
    <div className={cn(card, "py-3")}>
      <p className={cn(label, "mb-1")}>Things to watch</p>
      {data.watch.map((w, i) => {
        const Icon = w.kind === "essential-over-pace" ? TrendingUp : CreditCard;
        return (
          <div key={w.label} className={cn(row, i === 0 && "border-t-0")}>
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon className={cn("h-4 w-4 shrink-0", w.kind === "card-low" ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400")} aria-hidden="true" />
              <span dir="auto">{w.label}</span>
            </span>
            <button
              type="button"
              className="shrink-0 text-[13px] text-sky-700 hover:underline dark:text-sky-400"
              onClick={() => (w.target.tab === "cards" ? navigate("cards", w.target.group) : openCategory(w.target.categoryId))}
            >
              Open
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function HomePage({ navigate }: { navigate: Navigate }) {
  const { data, loading, error } = useSpending();
  const open = useOpen();
  if (!data) return <SpendingLoading />;

  const openCategory = (id: string) => {
    open.add("bar");
    open.add(`cat:${id}`);
  };

  return (
    <div className="space-y-3">
      {(loading || error) && (
        <p className={cn("flex items-center gap-1.5 text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {error ? `Could not refresh: ${error}` : <><Loader2 className="h-3 w-3 animate-spin" /> Refreshing the numbers…</>}
        </p>
      )}
      <SpentVsIncomeCard data={data} navigate={navigate} open={open} />
      <AvailableCard key={JSON.stringify(data.available)} data={data} navigate={navigate} />
      <WatchCard data={data} navigate={navigate} openCategory={openCategory} />
    </div>
  );
}
