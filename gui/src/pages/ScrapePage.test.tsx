import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { ScrapePage } from "@/pages/ScrapePage";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    getAccounts: vi.fn().mockResolvedValue([
      { name: "Account A", companyId: "a", fields: [], enabled: true },
      { name: "Account B", companyId: "b", fields: [], enabled: false },
    ]),
  };
});

const SETTINGS_KEY = "scrape.settings.v1";

describe("ScrapePage settings persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("hydrates settings from localStorage on first render", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        daysBack: 15,
        outputDir: "/tmp/out",
        split: true,
        showBrowser: true,
        enableDetailedLogging: true,
        detailedLoggingLimit: 3,
        selectedAccounts: ["Account A"],
      })
    );

    render(<ScrapePage />);

    expect((screen.getByLabelText("Days Back") as HTMLInputElement).value).toBe("15");
    expect((screen.getByLabelText("Output Directory") as HTMLInputElement).value).toBe(
      "/tmp/out"
    );
    expect(screen.getByLabelText("Split by account")).toHaveAttribute("data-state", "checked");
    expect(screen.getByLabelText("Show browser")).toHaveAttribute("data-state", "checked");
    expect(screen.getByLabelText("Enable detailed logging")).toHaveAttribute(
      "data-state",
      "checked"
    );
    expect(
      (screen.getByLabelText("Log item limit (0 = all items)") as HTMLInputElement).value
    ).toBe("3");

    const accountCheckbox = await screen.findByLabelText("Account A");
    expect(accountCheckbox).toBeChecked();
  });

  it("persists changes back to localStorage", async () => {
    render(<ScrapePage />);

    fireEvent.change(screen.getByLabelText("Days Back"), {
      target: { value: "21" },
    });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
      expect(stored.daysBack).toBe(21);
    });
  });

  it("shows last scrape date on the settings view", async () => {
    localStorage.setItem(
      "scrape.lastRun.v1",
      JSON.stringify("2026-04-08T12:00:00.000Z")
    );

    render(<ScrapePage />);

    expect(await screen.findByText("Last scraped: 2026-04-08")).toBeInTheDocument();
  });

  it("defaults days back to one day before the last scrape date on reset", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:00:00.000Z"));

    try {
      localStorage.setItem(
        "scrape.payload.v1",
        JSON.stringify({
          scrapeResults: [],
          kept: [],
          skipped: [],
          rows: [],
          summary: { byAccount: {}, totalOutflow: 0, totalInflow: 0 },
          auditLog: { timestamp: "2026-04-08T08:00:00.000Z" },
        })
      );

      render(<ScrapePage />);

      fireEvent.click(await screen.findByRole("button", { name: "Scrape Again" }));

      expect((await screen.findByLabelText("Days Back") as HTMLInputElement).value).toBe(
        "2"
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
