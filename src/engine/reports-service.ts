import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAppConfigDir } from "../env.js";
import { loadYnabImportConfig, ynabRequest } from "../ynab/import-service.js";
import { getSpending } from "./safe-spending-service.js";
import type { MonthCategory } from "./safe-spending.js";
import {
  dueReports,
  monthEndReport,
  monthStartReport,
  weeklyReport,
  type Report,
  type ReportInput,
  type ReportState,
  type ReportType,
} from "./reports.js";

export const REPORT_TYPES: ReportType[] = ["weekly", "month-start", "month-end"];

function reportsDir(): string {
  const dir = join(getAppConfigDir(), "reports");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf-8")) as T) : null;
}

export function loadState(): ReportState {
  return readJson<ReportState>(join(reportsDir(), "state.json")) ?? {};
}

/** The latest report of each type, or null when none was made yet. */
export function latestReports(): Record<ReportType, Report | null> {
  const dir = reportsDir();
  return Object.fromEntries(REPORT_TYPES.map((t) => [t, readJson<Report>(join(dir, `latest-${t}.json`))])) as Record<ReportType, Report | null>;
}

function save(report: Report, stateValue: string): void {
  const dir = reportsDir();
  const stamp = report.generatedAt.slice(0, 10);
  writeFileSync(join(dir, `latest-${report.type}.json`), JSON.stringify(report, null, 2), "utf-8");
  writeFileSync(join(dir, `${report.type}-${stamp}.json`), JSON.stringify(report, null, 2), "utf-8");
  const state = loadState();
  state[report.type] = stateValue;
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2), "utf-8");
}

function previousMonth(today: string): string {
  return new Date(Date.parse(`${today.slice(0, 7)}-01T00:00:00Z`) - 86400000).toISOString().slice(0, 7);
}

/** Builds and saves one report. `month` (yyyy-mm) is used by the end-of-month report only. */
export async function generateReport(token: string, type: ReportType, month?: string, now = new Date()): Promise<Report> {
  const today = now.toISOString().slice(0, 10);
  const generatedAt = now.toISOString();
  const s = await getSpending(token, today);
  const input: ReportInput = {
    today,
    periodEnd: s.periodEnd,
    mode: s.settings.mode,
    cashflow: s.cashflow,
    ynab: s.ynab,
    baseline: s.baseline,
    exposure: s.exposure,
    obligations: s.obligations,
    upcoming: s.upcoming,
    suggestionsCount: s.suggestions.length,
    anomalies: s.anomalies,
    uncategorizedCount: s.uncategorizedCount,
    previousMonth: s.previousMonth,
  };

  if (type === "weekly") {
    const report = weeklyReport(input, generatedAt);
    save(report, today);
    return report;
  }
  if (type === "month-start") {
    const report = monthStartReport(input, generatedAt);
    save(report, today.slice(0, 7));
    return report;
  }

  const target = month ?? previousMonth(today);
  const budget = loadYnabImportConfig().budgetId;
  const { month: data } = await ynabRequest<{ month: { categories: Array<MonthCategory & { budgeted: number; activity: number }> } }>(
    token,
    `/budgets/${encodeURIComponent(budget)}/months/${target}-01`
  );
  const normals = new Map(s.baseline.categories.map((c) => [c.name, c.normalMonth]));
  const groupOf = new Map(s.categories.map((c) => [c.id, c.group]));
  const categories = data.categories
    .filter((c) => !c.hidden && !c.deleted && groupOf.has(c.id))
    .map((c) => ({ name: c.name, group: groupOf.get(c.id)!, assigned: c.budgeted, spent: -c.activity, normal: normals.get(c.name) ?? 0 }));
  const report = monthEndReport(target, categories, s.monthTotals(target), s.baseline.asOf, generatedAt);
  save(report, target);
  return report;
}

/** The daily scheduled run: makes each report that is due, once. */
export async function runDueReports(token: string, now = new Date()): Promise<Report[]> {
  const made: Report[] = [];
  for (const due of dueReports(now.toISOString().slice(0, 10), loadState())) {
    made.push(await generateReport(token, due.type, due.month, now));
  }
  return made;
}
