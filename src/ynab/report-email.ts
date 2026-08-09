import nodemailer from "nodemailer";
import {
  buildCategoryAvailabilityHtml,
  getCategoryAvailabilityReport,
  type CategoryAvailabilityReport,
  type CategorySelection,
} from "./report-service.js";

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
  input: SendCategoryAvailabilityEmailInput
): Promise<SendCategoryAvailabilityEmailResult> {
  const missing = [
    ["smtpUser", input.smtpUser],
    ["smtpAppPassword", input.smtpAppPassword],
    ["recipientEmail", input.recipientEmail],
  ].filter(([, value]) => !value.trim()).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing required email fields: ${missing.join(", ")}`);
  }

  const now = input.now ?? new Date();
  const timezone = input.timezone ?? "Asia/Jerusalem";
  const locale = input.locale ?? "en-IL";
  const report = await getCategoryAvailabilityReport(input);
  const subject = buildSubject(now, locale, timezone);
  const html = buildCategoryAvailabilityHtml(report);
  const text = buildTextReport(report);

  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: input.smtpUser, pass: input.smtpAppPassword },
  });
  await transport.sendMail({
    from: `YNAB Reporter <${input.smtpUser}>`,
    to: input.recipientEmail,
    subject,
    html,
    text,
  });

  return { subject, report };
}
