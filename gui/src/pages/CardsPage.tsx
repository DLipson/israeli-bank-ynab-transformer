import { ChevronDown, ChevronRight } from "lucide-react";
import type { CardGroup } from "@/api/client";
import { Expand, Line, Muted, TxLine } from "@/components/Rows";
import { SpendingLoading } from "@/pages/SpendingPage";
import type { Navigate } from "@/pages/HomePage";
import { card, label, link, useOpen } from "@/lib/rows";
import { formatDate, monthLabel, shekels, useSpending } from "@/lib/spending";
import { cn } from "@/lib/utils";

const STATE_TEXT: Record<CardGroup["state"], string> = {
  ok: "",
  "no-limit": "",
  low: "text-amber-700 dark:text-amber-400",
  over: "text-red-700 dark:text-red-400",
};
const STATE_BAR: Record<CardGroup["state"], string> = {
  ok: "bg-muted-foreground",
  "no-limit": "bg-muted-foreground",
  low: "bg-amber-500",
  over: "bg-red-500",
};

const left = (n: number) => `${n} payment${n === 1 ? "" : "s"} left`;
/** Spec: mark installments that end within 2 months. */
const endsSoon = (n: number) => (n <= 2 ? <Muted>· ends soon</Muted> : null);

function Group({ g, open }: { g: CardGroup; open: ReturnType<typeof useOpen> }) {
  const key = `g:${g.name}`;
  const used = g.balance + g.futureInstallments;
  const Chevron = open.is(key) ? ChevronDown : ChevronRight;
  return (
    <div className="border-t py-2">
      <button type="button" onClick={() => open.toggle(key)} aria-expanded={open.is(key)} className="w-full text-left">
        <span className="flex justify-between gap-2 text-sm">
          <span className="flex min-w-0 items-center gap-1">
            <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{g.name}</span>
          </span>
          <span className={cn("shrink-0", STATE_TEXT[g.state])}>
            {g.limit === null || g.headroom === null ? `${shekels(used)} used · no limit set` : `${shekels(g.headroom)} left of ${shekels(g.limit)}`}
          </span>
        </span>
        {g.limit !== null && (
          <span className="mt-1.5 block h-1.5 rounded-md bg-muted">
            <span className={cn("block h-1.5 rounded-md", STATE_BAR[g.state])} style={{ width: `${Math.min(100, (used / Math.max(g.limit, 1)) * 100)}%` }} />
          </span>
        )}
      </button>
      {open.is(key) && (
        <div className="mt-1.5">
          <Expand
            title={<span className="font-medium">Next payment{g.nextPayment.date && ` (${formatDate(g.nextPayment.date)})`}</span>}
            amount={shekels(g.nextPayment.total)}
            open={open.is(`${key}:next`)}
            onToggle={() => open.toggle(`${key}:next`)}
          >
            <Expand title="New purchases" amount={shekels(g.nextPayment.newPurchases.amount)} open={open.is(`${key}:new`)} onToggle={() => open.toggle(`${key}:new`)}>
              {g.nextPayment.newPurchases.items.map((t) => (
                <TxLine key={t.id} t={t} spend />
              ))}
            </Expand>
            <Expand
              title="Installments of older purchases"
              amount={shekels(g.nextPayment.olderInstallments.amount)}
              open={open.is(`${key}:old`)}
              onToggle={() => open.toggle(`${key}:old`)}
            >
              {g.nextPayment.olderInstallments.items.map((t) => (
                <TxLine key={t.id} t={t} spend note={<Muted>· payment {t.payment}</Muted>} />
              ))}
            </Expand>
          </Expand>
          <Expand title="Future installments, by month" amount={shekels(g.futureInstallments)} open={open.is(`${key}:future`)} onToggle={() => open.toggle(`${key}:future`)}>
            {g.futureByMonth.map((m) => (
              <Expand key={m.month} title={monthLabel(m.month)} amount={shekels(m.amount)} open={open.is(`${key}:${m.month}`)} onToggle={() => open.toggle(`${key}:${m.month}`)}>
                {m.plans.map((p, i) => (
                  <Line key={`${p.payee}-${i}`} text={p.payee} amount={p.payment} note={<Muted>· {left(p.paymentsLeft)}{endsSoon(p.paymentsLeft)}</Muted>} />
                ))}
              </Expand>
            ))}
            {g.futureByMonth.length === 0 && <p className="border-t py-1.5 text-sm text-muted-foreground">No future installments.</p>}
          </Expand>
        </div>
      )}
    </div>
  );
}

export function CardsPage({ navigate, openGroup }: { navigate: Navigate; openGroup?: string }) {
  const { data } = useSpending();
  const open = useOpen(openGroup ? [`g:${openGroup}`] : []);
  if (!data) return <SpendingLoading />;

  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className={label}>Credit headroom</p>
          <span className={label}>
            Orange below {shekels(data.settings.cardWarningLevel)}{" "}
            <button type="button" className={link} onClick={() => navigate("settings", "spending")}>
              Change
            </button>
          </span>
        </div>
        {data.cards.map((g) => (
          <Group key={g.name} g={g} open={open} />
        ))}
      </div>

      <div className={card}>
        <p className={cn(label, "mb-1.5")}>Coming months · bills and installments</p>
        {data.obligations.slice(0, 6).map((m) => (
          <Expand key={m.month} title={monthLabel(m.month)} amount={shekels(m.total)} open={open.is(`m:${m.month}`)} onToggle={() => open.toggle(`m:${m.month}`)}>
            <Expand title="Scheduled bills" amount={shekels(m.scheduled)} open={open.is(`m:${m.month}:s`)} onToggle={() => open.toggle(`m:${m.month}:s`)}>
              {m.items.scheduled.map((s, i) => (
                <Line key={`${s.label}-${i}`} text={s.label} date={s.date} amount={s.amount} />
              ))}
            </Expand>
            <Expand title="Card installments" amount={shekels(m.installments)} open={open.is(`m:${m.month}:i`)} onToggle={() => open.toggle(`m:${m.month}:i`)}>
              {m.items.installments.map((p, i) => (
                <Line key={`${p.payee}-${i}`} text={p.payee} amount={p.payment} note={<Muted>· {p.account} · {left(p.paymentsLeft)}{endsSoon(p.paymentsLeft)}</Muted>} />
              ))}
            </Expand>
          </Expand>
        ))}
      </div>
    </div>
  );
}
