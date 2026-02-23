import { describe, expect, it, vi } from "vitest";
import { sendCategoryAvailabilityEmail } from "./report-email.js";
import type { CategoryAvailabilityReport } from "./report-service.js";

function createReport(): CategoryAvailabilityReport {
  return {
    budgetId: "budget-1",
    timezone: "Asia/Jerusalem",
    currency: "ILS",
    generatedAtIso: "2026-02-17T05:00:00.000Z",
    generatedAtLocal: "Feb 17, 2026, 7:00 AM",
    rows: [
      {
        id: "cat-1",
        name: "Groceries",
        groupName: "Monthly",
        availableMilliunits: 550_000,
        available: "₪550.00",
        status: "green",
      },
    ],
    totals: {
      red: 0,
      yellow: 0,
      green: 1,
      count: 1,
    },
  };
}

describe("sendCategoryAvailabilityEmail", () => {
  it("builds report then sends email with generated subject", async () => {
    const report = createReport();
    const getReport = vi.fn().mockResolvedValue(report);
    const sendEmail = vi.fn().mockResolvedValue(undefined);

    const result = await sendCategoryAvailabilityEmail(
      {
        token: "token",
        budgetId: "budget-1",
        recipientEmail: "recipient@example.com",
        smtpUser: "sender@gmail.com",
        smtpAppPassword: "app-password",
        selectedCategories: [{ id: "cat-1" }],
        timezone: "Asia/Jerusalem",
      },
      {
        getReport,
        sendEmail,
      }
    );

    expect(getReport).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]?.[0]).toMatchObject({
      to: "recipient@example.com",
      smtpUser: "sender@gmail.com",
    });
    expect(result.subject).toContain("YNAB Daily Available Amounts");
    expect(result.report.totals.green).toBe(1);
  });
});
