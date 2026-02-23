import {
  buildCategoryAvailabilityHtml,
  getCategoryAvailabilityReport,
  type CategoryAvailabilityReport,
  type CategorySelection,
} from "./report-service.js";
import { sendEmail, type SendEmailInput } from "./email-service.js";

export interface SendCategoryAvailabilityEmailInput {
  token: string;
  budgetId: string;
  selectedCategories: CategorySelection[];
  recipientEmail: string;
  smtpUser: string;
  smtpAppPassword: string;
  timezone?: string;
  currency?: string;
  locale?: string;
  yellowThresholdMilliunits?: number;
  now?: Date;
}

export interface SendCategoryAvailabilityEmailResult {
  subject: string;
  report: CategoryAvailabilityReport;
}

interface SendCategoryAvailabilityEmailDeps {
  getReport?: typeof getCategoryAvailabilityReport;
  sendEmail?: (input: SendEmailInput) => Promise<void>;
  buildHtml?: typeof buildCategoryAvailabilityHtml;
}

function buildSubject(now: Date, locale: string, timezone: string): string {
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `YNAB Daily Available Amounts - ${date} (${timezone})`;
}

function buildTextReport(report: CategoryAvailabilityReport): string {
  const rows = report.rows.map((row) => `${row.status.toUpperCase()} | ${row.name} | ${row.available}`).join("\n");
  return [
    "YNAB Category Availability",
    `Generated: ${report.generatedAtLocal} (${report.timezone})`,
    `Red: ${report.totals.red} | Yellow: ${report.totals.yellow} | Green: ${report.totals.green}`,
    "",
    rows,
  ].join("\n");
}

export async function sendCategoryAvailabilityEmail(
  input: SendCategoryAvailabilityEmailInput,
  deps: SendCategoryAvailabilityEmailDeps = {}
): Promise<SendCategoryAvailabilityEmailResult> {
  const getReport = deps.getReport ?? getCategoryAvailabilityReport;
  const send = deps.sendEmail ?? sendEmail;
  const buildHtml = deps.buildHtml ?? buildCategoryAvailabilityHtml;
  const now = input.now ?? new Date();
  const timezone = input.timezone ?? "Asia/Jerusalem";
  const locale = input.locale ?? "en-IL";

  const report = await getReport({
    token: input.token,
    budgetId: input.budgetId,
    selectedCategories: input.selectedCategories,
    timezone: input.timezone,
    currency: input.currency,
    locale: input.locale,
    yellowThresholdMilliunits: input.yellowThresholdMilliunits,
    now: input.now,
  });

  const subject = buildSubject(now, locale, timezone);
  const html = buildHtml(report);
  const text = buildTextReport(report);

  await send({
    smtpUser: input.smtpUser,
    smtpAppPassword: input.smtpAppPassword,
    to: input.recipientEmail,
    subject,
    html,
    text,
  });

  return { subject, report };
}
