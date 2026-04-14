import { loadCategoryReportConfig } from "./report-config.js";
import { sendCategoryAvailabilityEmail } from "./report-email.js";
import { getLocalHour, shouldRunAtLocalHour } from "./schedule.js";
import { loadAppEnv } from "../env.js";

loadAppEnv();

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseSendHour(value: string | undefined): number {
  const hour = value ? Number(value) : 7;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`Invalid YNAB_REPORT_SEND_HOUR: ${value}`);
  }
  return hour;
}

async function run(): Promise<void> {
  const force = process.argv.includes("--force");
  const now = new Date();
  const config = loadCategoryReportConfig();
  const timezone = process.env.YNAB_REPORT_TIMEZONE?.trim() || config.timezone || "Asia/Jerusalem";
  const sendHour = parseSendHour(process.env.YNAB_REPORT_SEND_HOUR);
  const localHour = getLocalHour(now, timezone);

  if (!force && !shouldRunAtLocalHour(now, timezone, sendHour)) {
    console.log(
      `Skipping send at ${now.toISOString()} because local hour ${localHour} in ${timezone} does not match ${sendHour}.`
    );
    return;
  }

  const token = getRequiredEnv("YNAB_API_TOKEN");
  const recipientEmail = getRequiredEnv("YNAB_REPORT_RECIPIENT_EMAIL");
  const smtpUser = getRequiredEnv("GMAIL_SMTP_USER");
  const smtpAppPassword = getRequiredEnv("GMAIL_SMTP_APP_PASSWORD");
  const yellowThreshold = config.yellowThreshold ?? 200;
  const yellowThresholdMilliunits = Math.round(yellowThreshold * 1000);

  const result = await sendCategoryAvailabilityEmail({
    token,
    budgetId: config.budgetId,
    selectedCategories: config.selectedCategories,
    recipientEmail,
    smtpUser,
    smtpAppPassword,
    timezone,
    currency: config.currency,
    locale: config.locale,
    yellowThresholdMilliunits,
    now,
  });

  console.log(`Email sent to ${recipientEmail}`);
  console.log(`Subject: ${result.subject}`);
  console.log(
    `Totals => red: ${result.report.totals.red}, yellow: ${result.report.totals.yellow}, green: ${result.report.totals.green}`
  );
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
