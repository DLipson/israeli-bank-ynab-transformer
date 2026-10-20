import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAppConfigDir } from "../env.js";
import { loadYnabImportConfig, ynabRequest } from "../ynab/import-service.js";
import { getSpending } from "./safe-spending-service.js";
import { pastMonths } from "./baseline.js";
import { spendingCategories, type Month } from "./safe-spending.js";
import { dueReports, monthlyReport, type Report, type ReportState, type ReportType } from "./reports.js";

/** Report types that can be made now. */
export const REPORT_TYPES: ReportType[] = ["monthly"];
/** Every type that may have a saved report: older reports stay readable. */
const SAVED_TYPES: ReportType[] = ["monthly", "weekly", "month-start", "month-end"];

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

/** The latest saved report of each type, or null when none was made. */
export function latestReports(): Record<ReportType, Report | null> {
  const dir = reportsDir();
  return Object.fromEntries(SAVED_TYPES.map((t) => [t, readJson<Report>(join(dir, `latest-${t}.json`))])) as Record<ReportType, Report | null>;
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

/** Builds and saves the monthly report. Read-only towards YNAB. */
export async function generateReport(token: string, type: ReportType = "monthly", now = new Date()): Promise<Report> {
  if (type !== "monthly") throw new Error("Only the monthly report is made now.");
  const today = now.toISOString().slice(0, 10);
  const s = await getSpending(token, today);
  const lastMonth = pastMonths(today, 1)[0];
  const budget = `/budgets/${encodeURIComponent(loadYnabImportConfig().budgetId)}`;
  const [{ month: previous }, { month: current }] = await Promise.all([
    ynabRequest<{ month: Month }>(token, `${budget}/months/${lastMonth}-01`),
    ynabRequest<{ month: Month }>(token, `${budget}/months/current`),
  ]);
  const normals = new Map(s.baseline.categories.map((c) => [c.name, c.normalMonth]));
  const groupOf = new Map(s.categories.map((c) => [c.id, c.group]));

  const report = monthlyReport(
    {
      today,
      lastScrapedAt: s.lastScrapedAt,
      dataAsOf: s.baseline.asOf,
      months: pastMonths(today, 6).reverse().map(s.monthFlow),
      fixedLastMonth: s.fixedSpent(lastMonth),
      lastMonthCategories: spendingCategories(previous)
        .filter((c) => groupOf.has(c.id))
        .map((c) => ({ name: c.name, group: groupOf.get(c.id)!, assigned: c.budgeted, spent: -(c.activity ?? 0), normal: normals.get(c.name) ?? 0 })),
      available: s.available,
      scheduledThisMonth: s.upcoming.filter((u) => u.date.startsWith(today.slice(0, 7))),
      gaps: spendingCategories(current)
        .filter((c) => normals.has(c.name))
        .map((c) => ({ name: c.name, assigned: c.budgeted, normal: normals.get(c.name)! })),
    },
    now.toISOString()
  );
  save(report, today.slice(0, 7));
  return report;
}

/** The daily scheduled run: makes the monthly report when it is due, once a month. */
export async function runDueReports(token: string, now = new Date()): Promise<Report[]> {
  const made: Report[] = [];
  for (const due of dueReports(now.toISOString().slice(0, 10), loadState())) made.push(await generateReport(token, due.type, now));
  return made;
}
