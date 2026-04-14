import { Router, type Request, type Response } from "express";
import {
  buildCategoryAvailabilityHtml,
  getCategoryAvailabilityReport,
  type CategorySelection,
} from "../../ynab/report-service.js";
import { loadCategoryReportConfig } from "../../ynab/report-config.js";
import { sendCategoryAvailabilityEmail } from "../../ynab/report-email.js";

const router = Router();

interface ReportPreviewBody {
  budgetId?: string;
  categories?: CategorySelection[];
  timezone?: string;
  currency?: string;
  locale?: string;
  yellowThreshold?: number;
}

interface SendTestEmailBody {
  recipientEmail?: string;
}

router.post("/report/preview", async (req: Request, res: Response) => {
  const token = process.env.YNAB_API_TOKEN?.trim() ?? "";
  if (!token) {
    res.status(400).json({ error: "Missing YNAB_API_TOKEN in environment." });
    return;
  }

  try {
    const config = loadCategoryReportConfig();
    const body = (req.body ?? {}) as ReportPreviewBody;
    const budgetId = body.budgetId?.trim() || config.budgetId;
    const selectedCategories =
      body.categories && body.categories.length > 0 ? body.categories : config.selectedCategories;
    const timezone = body.timezone?.trim() || config.timezone;
    const currency = body.currency?.trim() || config.currency;
    const locale = body.locale?.trim() || config.locale;
    const yellowThreshold = body.yellowThreshold ?? config.yellowThreshold ?? 200;
    const yellowThresholdMilliunits = Math.round(yellowThreshold * 1000);

    const report = await getCategoryAvailabilityReport({
      token,
      budgetId,
      selectedCategories,
      timezone,
      currency,
      locale,
      yellowThresholdMilliunits,
    });

    const html = buildCategoryAvailabilityHtml(report);
    res.json({ report, html });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.post("/report/send-test-email", async (req: Request, res: Response) => {
  const token = process.env.YNAB_API_TOKEN?.trim() ?? "";
  const smtpUser = process.env.GMAIL_SMTP_USER?.trim() ?? "";
  const smtpAppPassword = process.env.GMAIL_SMTP_APP_PASSWORD?.trim() ?? "";
  const body = (req.body ?? {}) as SendTestEmailBody;
  const recipientEmail =
    body.recipientEmail?.trim() ?? process.env.YNAB_REPORT_RECIPIENT_EMAIL?.trim() ?? "";

  const missing: string[] = [];
  if (!token) missing.push("YNAB_API_TOKEN");
  if (!smtpUser) missing.push("GMAIL_SMTP_USER");
  if (!smtpAppPassword) missing.push("GMAIL_SMTP_APP_PASSWORD");
  if (!recipientEmail) missing.push("YNAB_REPORT_RECIPIENT_EMAIL");
  if (missing.length > 0) {
    res.status(400).json({ error: `Missing required environment values: ${missing.join(", ")}` });
    return;
  }

  try {
    const config = loadCategoryReportConfig();
    const yellowThreshold = config.yellowThreshold ?? 200;
    const yellowThresholdMilliunits = Math.round(yellowThreshold * 1000);

    const result = await sendCategoryAvailabilityEmail({
      token,
      budgetId: config.budgetId,
      selectedCategories: config.selectedCategories,
      recipientEmail,
      smtpUser,
      smtpAppPassword,
      timezone: config.timezone,
      currency: config.currency,
      locale: config.locale,
      yellowThresholdMilliunits,
    });

    res.json({
      recipientEmail,
      subject: result.subject,
      totals: result.report.totals,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
