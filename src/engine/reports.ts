/**
 * Reports: weekly status, start of month, end of month. Pure: they turn engine results into
 * sections of labelled values, which the app shows (and email can show later).
 * Spec: docs/financial-intelligence-notes.md, "Plan: reports + spending baseline".
 */
import type { Baseline, Pace } from "./baseline.js";
import type { Anomaly } from "./anomalies.js";
import { formatShekels as f, type ExposureGroup, type LeftToSpend, type MonthObligations } from "./safe-spending.js";

export type ReportType = "weekly" | "month-start" | "month-end";

export type Tone = "good" | "bad" | "warn" | "muted";

export interface ReportRow {
  label: string;
  value: string;
  tone?: Tone;
}

export interface ReportSection {
  title: string;
  rows: ReportRow[];
  note?: string;
  explanation?: string;
  /** Saved calculation inputs, so the report can explain itself later. */
  details?: ReportRow[];
}

export interface Report {
  type: ReportType;
  title: string;
  generatedAt: string;
  dataAsOf: string;
  /** Missing on reports saved before scrape timestamps were recorded. */
  lastScrapedAt?: string | null;
  sections: ReportSection[];
}

/** What the reports read: the engine output plus a few extra facts. */
export interface ReportInput {
  today: string;
  lastScrapedAt: string | null;
  periodEnd: string;
  mode: "cashflow" | "ynab";
  cashflow: LeftToSpend;
  ynab: LeftToSpend;
  baseline: Baseline;
  exposure: ExposureGroup[];
  obligations: MonthObligations[];
  /** Scheduled outflows from today, with their dates. */
  upcoming: Array<{ date: string; label: string; amount: number }>;
  suggestionsCount: number;
  anomalies: Anomaly[];
  uncategorizedCount: number;
  previousMonth: { month: string; spent: number; normal: number };
}

export interface MonthCategoryResult {
  name: string;
  group: string;
  assigned: number;
  spent: number;
  normal: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function monthName(yyyyMm: string): string {
  return new Date(`${yyyyMm}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function dayName(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function percent(d: number | null): string {
  return d === null ? "" : ` (${d > 0 ? "+" : ""}${Math.round(d * 100)}%)`;
}

function paceRow(p: Pace): ReportRow {
  const labels: Record<Pace["status"], string> = {
    under: "under pace",
    on: "on pace",
    over: "over pace",
    "fixed-paid": "paid",
    "fixed-due": "not paid yet",
  };
  const tone: Tone = p.status === "over" ? "bad" : p.status === "under" ? "good" : "muted";
  const value = p.status.startsWith("fixed")
    ? `${labels[p.status]} (normally ${f(p.normalMonth)})`
    : `${f(p.thisMonth)} vs. normal ${f(p.normalByToday)} — ${labels[p.status]}${percent(p.difference)}`;
  return { label: p.name, value, tone };
}

function leftSection(input: ReportInput, title: string): ReportSection {
  const main = input.mode === "cashflow" ? input.cashflow : input.ynab;
  const other = input.mode === "cashflow" ? input.ynab : input.cashflow;
  const names = { cashflow: "Cash-flow", ynab: "YNAB categories" };
  const expected = input.cashflow.lines.find((l) => l.label.startsWith("Expected normal spending"));
  const rows: ReportRow[] = [
    { label: `${names[input.mode]} (main)`, value: f(main.total), tone: main.total < 0 ? "bad" : undefined },
    { label: names[input.mode === "cashflow" ? "ynab" : "cashflow"], value: f(other.total), tone: "muted" },
  ];
  if (expected) rows.push({ label: "Normal spending still expected", value: f(-expected.amount), tone: "muted" });
  const explanation =
    input.mode === "cashflow"
      ? `This estimate covers ${dayName(input.today)} through ${dayName(input.periodEnd)}. The lines below show the account balances and deductions used to get the total.`
      : `This adds the available balances in the spending groups shown below, using the current YNAB budget on ${dayName(input.today)}. Money in Ready to Assign is left out.`;
  const note = [
    ...main.warnings,
    ...(input.mode === "cashflow" ? ["Future credit card installments are not included in this number."] : []),
  ].join(" ");
  return {
    title,
    rows,
    explanation,
    details: main.lines.map((line) => ({ label: line.label, value: f(line.amount), tone: line.amount < 0 ? "muted" : undefined })),
    note: note || undefined,
  };
}

function attentionSection(input: ReportInput): ReportSection {
  const rows: ReportRow[] = [];
  const scrapeDate = input.lastScrapedAt?.slice(0, 10);
  const age = scrapeDate ? Math.max(0, Math.round((Date.parse(input.today) - Date.parse(scrapeDate)) / DAY_MS)) : null;
  if (age === null) rows.push({ label: "Bank data", value: "no successful scrape recorded: run a scrape", tone: "warn" });
  else if (age >= 3) rows.push({ label: "Bank data", value: `last successful scrape ${dayName(scrapeDate!)} (${age} days ago): run a scrape`, tone: "warn" });
  if (input.suggestionsCount) rows.push({ label: "Repeating payments without a schedule", value: String(input.suggestionsCount), tone: "warn" });
  if (input.uncategorizedCount) rows.push({ label: "Uncategorized transactions", value: String(input.uncategorizedCount), tone: "warn" });
  const noLimit = input.exposure.filter((g) => g.limit === null && g.used > 0).length;
  if (noLimit) rows.push({ label: "Cards with no limit set", value: String(noLimit), tone: "warn" });
  if (!rows.length) rows.push({ label: "Nothing", value: "All clear", tone: "good" });
  return { title: "Needs attention", rows };
}

export function weeklyReport(input: ReportInput, generatedAt: string): Report {
  const b = input.baseline;
  const weekEnd = addDays(input.today, 7);
  const next7 = input.upcoming.filter((u) => u.date <= weekEnd);
  const paceRows = [paceRow({ ...b.total, name: "All spending" }), ...b.topOver.map(paceRow)];
  if (b.uncategorized) paceRows.push({ label: "Not categorized yet", value: f(b.uncategorized), tone: "warn" });

  return {
    type: "weekly",
    title: `Weekly report — ${dayName(input.today)}`,
    generatedAt,
    dataAsOf: b.asOf,
    lastScrapedAt: input.lastScrapedAt,
    sections: [
      leftSection(input, `Left to spend until ${dayName(input.periodEnd)}`),
      {
        title: `Pace this month (up to ${dayName(b.asOf)})`,
        rows: paceRows,
        note: b.topOver.length ? undefined : "No category is over pace.",
      },
      {
        title: "Unusual this week",
        rows: input.anomalies.filter((a) => a.date >= addDays(input.today, -7)).slice(0, 5).map((a) => ({ label: a.title, value: a.detail, tone: "warn" as Tone })),
        note: input.anomalies.some((a) => a.date >= addDays(input.today, -7)) ? undefined : "Nothing unusual.",
      },
      {
        title: "Scheduled payments in the next 7 days",
        rows: next7.length
          ? next7.map((u) => ({ label: `${dayName(u.date)} · ${u.label}`, value: f(u.amount) }))
          : [{ label: "None", value: "", tone: "muted" }],
      },
      {
        title: "Credit",
        rows: input.exposure.map((g) => ({
          label: g.name,
          value: g.unused === null ? `${f(g.used)} used, limit not set` : `${f(g.unused)} unused of ${f(g.limit ?? 0)}`,
          tone: g.unused !== null && g.unused < 0 ? "bad" : undefined,
        })),
      },
      attentionSection(input),
    ],
  };
}

export function monthStartReport(input: ReportInput, generatedAt: string): Report {
  const month = input.today.slice(0, 7);
  const prev = input.previousMonth;
  const diff = prev.normal ? prev.spent / prev.normal - 1 : null;
  const thisMonthScheduled = input.upcoming.filter((u) => u.date.startsWith(month));

  return {
    type: "month-start",
    title: `Start of ${monthName(month)}`,
    generatedAt,
    dataAsOf: input.baseline.asOf,
    lastScrapedAt: input.lastScrapedAt,
    sections: [
      {
        title: `${monthName(prev.month)} in one line`,
        rows: [
          {
            label: "Spent",
            value: `${f(prev.spent)} vs. normal ${f(prev.normal)}${percent(diff)}`,
            tone: diff !== null && diff > 0.15 ? "bad" : diff !== null && diff < -0.15 ? "good" : undefined,
          },
        ],
      },
      leftSection(input, `This month's capacity (until ${dayName(input.periodEnd)})`),
      {
        title: "Scheduled payments this month",
        rows: [
          ...thisMonthScheduled.map((u) => ({ label: `${dayName(u.date)} · ${u.label}`, value: f(u.amount) })),
          { label: "Total", value: f(thisMonthScheduled.reduce((s, u) => s + u.amount, 0)) },
        ],
      },
      {
        title: "Next 3 months",
        rows: input.obligations.slice(0, 3).map((o) => ({
          label: monthName(o.month),
          value: `${f(o.total)} (${f(o.scheduled)} scheduled + ${f(o.installments)} installments)`,
        })),
      },
      attentionSection(input),
    ],
  };
}

const MONTH_END_ROWS = 10;

/**
 * Totals come from the same spending list as the other reports (so uncategorized spending is in
 * them); the rows compare each category with what was assigned to it in YNAB.
 */
export function monthEndReport(
  month: string,
  categories: MonthCategoryResult[],
  totals: { spent: number; normal: number; uncategorized: number },
  dataAsOf: string,
  generatedAt: string,
  lastScrapedAt: string | null = null
): Report {
  const assigned = categories.reduce((sum, c) => sum + c.assigned, 0);
  const differences = categories
    .filter((c) => c.spent || c.assigned)
    .map((c) => ({ ...c, gap: c.spent - c.assigned }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, MONTH_END_ROWS);

  return {
    type: "month-end",
    title: `End of ${monthName(month)}: actual vs. plan`,
    generatedAt,
    dataAsOf,
    lastScrapedAt,
    sections: [
      {
        title: "Totals",
        rows: [
          { label: "Spent", value: f(totals.spent) },
          ...(totals.uncategorized
            ? [{ label: "of which not categorized", value: f(totals.uncategorized), tone: "warn" as Tone }]
            : []),
          { label: "Assigned in YNAB", value: f(assigned), tone: "muted" },
          { label: "Normal month (baseline)", value: f(totals.normal), tone: "muted" },
          {
            label: "Spent vs. assigned",
            value: f(totals.spent - assigned),
            tone: totals.spent > assigned ? "bad" : "good",
          },
        ],
        explanation: "Spent comes from imported transactions for this month, including uncategorized ones. The rows below compare YNAB category activity with the amount assigned; they may not add up to the imported spending total.",
        details: [
          ...categories.map((c) => ({
            label: `${c.group} / ${c.name}`,
            value: `YNAB activity ${f(c.spent)} · assigned ${f(c.assigned)}`,
          })),
          ...(totals.uncategorized ? [{ label: "Not categorized", value: `spent ${f(totals.uncategorized)}`, tone: "warn" as Tone }] : []),
        ],
      },
      {
        title: "Biggest differences from the plan",
        rows: differences.map((c) => ({
          label: `${c.name}`,
          value: `spent ${f(c.spent)} · assigned ${f(c.assigned)} · normal ${f(c.normal)}`,
          tone: c.gap > 0 ? "bad" : "good",
        })),
        note: "Over plan = spent more than assigned. Normal = the baseline median.",
      },
    ],
  };
}

// --- When each report is due (the daily scheduled run uses this) ---

export interface ReportState {
  /** Date of the last weekly report. */
  weekly?: string;
  /** Month (yyyy-mm) of the last start-of-month report. */
  "month-start"?: string;
  /** Month (yyyy-mm) that the last end-of-month report covered. */
  "month-end"?: string;
}

function lastDayOfMonth(date: string): boolean {
  return addDays(date, 1).slice(8, 10) === "01";
}

/** The most recent Sunday on or before `date`. */
function lastSunday(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -day);
}

/**
 * Reports due today. A missed run (PC off) is caught up once: the weekly report is due when none
 * was made since the last Sunday; the month-end report covers the current month on its last day,
 * otherwise the previous month.
 */
export function dueReports(today: string, state: ReportState): Array<{ type: ReportType; month?: string }> {
  const due: Array<{ type: ReportType; month?: string }> = [];
  if (!state.weekly || state.weekly < lastSunday(today)) due.push({ type: "weekly" });
  if (state["month-start"] !== today.slice(0, 7)) due.push({ type: "month-start" });
  const endMonth = monthEndTarget(today);
  if (state["month-end"] !== endMonth && (state["month-end"] ?? "") < endMonth) due.push({ type: "month-end", month: endMonth });
  return due;
}

export function monthEndTarget(today: string): string {
  return lastDayOfMonth(today) ? today.slice(0, 7) : addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
}
