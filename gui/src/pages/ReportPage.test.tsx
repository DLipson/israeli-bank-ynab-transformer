import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { ReportPage } from "@/pages/ReportPage";

vi.mock("@/api/client", () => ({
  previewCategoryReport: vi.fn().mockResolvedValue({
    report: {
      budgetId: "budget-1",
      timezone: "Asia/Jerusalem",
      currency: "ILS",
      generatedAtIso: "2026-02-17T07:00:00.000Z",
      generatedAtLocal: "Feb 17, 2026, 9:00 AM",
      rows: [
        {
          id: "cat-1",
          name: "Groceries",
          groupName: "Monthly",
          availableMilliunits: 550000,
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
    },
    html: "<html></html>",
  }),
  sendTestCategoryReportEmail: vi.fn().mockResolvedValue({
    recipientEmail: "recipient@example.com",
    subject: "YNAB Daily Available Amounts",
    totals: { red: 0, yellow: 0, green: 1, count: 1 },
  }),
}));

describe("ReportPage", () => {
  it("loads and renders preview rows", async () => {
    render(<ReportPage />);

    fireEvent.click(screen.getByRole("button", { name: "Generate Preview" }));

    await waitFor(() => {
      expect(screen.getByText("Preview Rows")).toBeInTheDocument();
    });

    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Monthly")).toBeInTheDocument();
  });

  it("sends test email from button", async () => {
    render(<ReportPage />);

    fireEvent.click(screen.getByRole("button", { name: "Send Test Email" }));

    await waitFor(() => {
      expect(screen.getByText("Sent test email to recipient@example.com")).toBeInTheDocument();
    });
  });
});
