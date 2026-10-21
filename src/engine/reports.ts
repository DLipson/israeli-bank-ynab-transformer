/**
 * The monthly report (spec section 4), made at the start of each month. Pure: it turns engine
 * results into sections of labelled values that the app shows. Older saved reports (weekly,
 * month-start, month-end) keep the same shape, so they stay readable.
 */
import { formatShekels as f } from "./safe-spending.js";

/** "monthly" is the only report made now; the others are types of older saved reports. */
export type ReportType = "monthly" | "weekly" | "month-start" | "month-end";

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
  /** Income vs spending per month, for a small bar chart. */
  chart?: Array<{ month: string; income: number; spent: number }>;
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

export interface MonthCategoryResult {
  name: string;
  group: string;
  assigned: number;
  spent: number;
  normal: number;
}

export interface MonthlyReportInput {
  today: string;
  lastScrapedAt: string | null;
  dataAsOf: string;
  /** The last 6 full months, oldest first: income counted and spending (spec rules). */
  months: Array<{ month: string; income: number; spent: number }>;
  /** Last month's spending in fixed categories. */
  fixedLastMonth: number;
  lastMonthCategories: MonthCategoryResult[];
  available: { periodEnd: string; total: number; lines: Array<{ key: string; label: string; amount: number }> };
  scheduledThisMonth: Array<{ date: string; label: string; amount: number }>;
  /** This month's categories: YNAB assigned vs normal month. */
  gaps: Array<{ name: string; assigned: number; normal: number }>;
}

const CATEGORY_ROWS = 10;
/** A gap between assigned and normal is shown from ₪200, the same minimum as the other thresholds. */
const MIN_GAP = 200 * 1000;

function monthName(yyyyMm: string): string {
  return new Date(`${yyyyMm}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function dayName(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const LINE_LABEL: Record<string, string> = {
  cash: "Cash",
  cards: "Card charges, already spent",
  bills: "Bills still to come",
  essentials: "Everyday essentials still to come",
  buffer: "Buffer",
};

export function monthlyReport(input: MonthlyReportInput, generatedAt: string): Report {
  const last = input.months[input.months.length - 1];
  const difference = last.income - last.spent;
  let withinIncome = 0;
  for (let i = input.months.length - 1; i >= 0 && input.months[i].income >= input.months[i].spent; i--) withinIncome++;
  const leftAfterFixed = last.income - input.fixedLastMonth;
  const byGap = input.lastMonthCategories
    .filter((c) => c.spent || c.assigned)
    .sort((a, b) => Math.abs(b.spent - b.assigned) - Math.abs(a.spent - a.assigned))
    .slice(0, CATEGORY_ROWS);
  const short = input.gaps.filter((g) => g.normal - g.assigned >= MIN_GAP).sort((a, b) => b.normal - b.assigned - (a.normal - a.assigned));

  return {
    type: "monthly",
    title: `Monthly report — ${monthName(input.today.slice(0, 7))}`,
    generatedAt,
    dataAsOf: input.dataAsOf,
    lastScrapedAt: input.lastScrapedAt,
    sections: [
      {
        title: `${monthName(last.month)}: income vs spending`,
        rows: [
          { label: "Income counted", value: f(last.income) },
          { label: "Spent", value: f(last.spent) },
          {
            label: "Difference",
            value: `${f(Math.abs(difference))} ${difference < 0 ? "more" : "less"} than you earned`,
            tone: difference < 0 ? "bad" : "good",
          },
        ],
        explanation: "Spending and income follow the Home rules: card purchases on the purchase date, no transfers, refunds lower spending, and income from the last 7 days of a month counts toward the next month.",
      },
      {
        title: "The last 6 months",
        rows: input.months.map((m) => ({
          label: monthName(m.month),
          value: `income ${f(m.income)} · spent ${f(m.spent)}`,
          tone: m.spent > m.income ? "bad" : undefined,
        })),
        chart: input.months,
      },
      {
        title: "Within income",
        rows: [
          {
            label: `${withinIncome} month${withinIncome === 1 ? "" : "s"} in a row within income`,
            value: "",
            tone: withinIncome ? "good" : "bad",
          },
        ],
      },
      {
        title: "Money for non-fixed spending",
        rows: [
          {
            label: `Fixed payments take ${f(input.fixedLastMonth)} of your ${f(last.income)}. ${f(leftAfterFixed)} is left for everything else.`,
            value: "",
            tone: leftAfterFixed < 0 ? "bad" : undefined,
          },
        ],
      },
      {
        title: `${monthName(last.month)} by category`,
        rows: byGap.map((c) => ({
          label: c.name,
          value: `spent ${f(c.spent)} · assigned ${f(c.assigned)} · normal ${f(c.normal)}`,
          tone: c.spent > c.assigned ? "bad" : "good",
        })),
        note: "Largest differences between spent and assigned first. Normal = the median month.",
      },
      {
        title: "This month",
        rows: [
          { label: `Available until payday (${dayName(input.available.periodEnd)})`, value: f(input.available.total), tone: input.available.total < 0 ? "bad" : undefined },
          ...input.scheduledThisMonth.map((s) => ({ label: `${dayName(s.date)} · ${s.label}`, value: f(s.amount), tone: "muted" as Tone })),
          ...short.map((g) => ({
            label: `${g.name}: assigned ${f(g.assigned)}, normal ${f(g.normal)}. Probably ${f(g.normal - g.assigned)} short.`,
            value: "",
            tone: "warn" as Tone,
          })),
        ],
        details: input.available.lines.map((l) => ({ label: LINE_LABEL[l.key] ?? l.label, value: f(l.amount) })),
        note: short.length ? "The app does not set targets: YNAB is where you set them. These rows show where they are probably too low." : undefined,
      },
    ],
  };
}

// --- When the report is due (the daily scheduled run uses this) ---

/** Month (yyyy-mm) of the last monthly report. Older keys (weekly, month-start, month-end) are ignored. */
export interface ReportState {
  monthly?: string;
  weekly?: string;
  "month-start"?: string;
  "month-end"?: string;
}

/** The monthly report is due once per month; a missed day (PC off) is caught up on the next run. */
export function dueReports(today: string, state: ReportState): Array<{ type: "monthly" }> {
  return state.monthly === today.slice(0, 7) ? [] : [{ type: "monthly" }];
}
