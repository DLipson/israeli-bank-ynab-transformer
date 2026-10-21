import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScrapePage } from "@/pages/ScrapePage";
import { ScrapeRunProvider } from "@/components/ScrapeRunProvider";
import { createScrapeStream, type SSEEvent } from "@/api/client";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    createScrapeStream: vi.fn(),
    getRuns: vi.fn().mockResolvedValue([
      {
        id: "r1",
        createdAt: "2026-10-15T10:00:00.000Z",
        settings: { daysBack: 7, accounts: ["Account A", "Account C"] },
        accounts: [
          { accountName: "Account A", success: true, transactionCount: 14 },
          { accountName: "Account C", success: false, transactionCount: 0, error: "Login page did not load" },
        ],
        exports: [],
        ynabImports: [],
        rowCount: 14,
        totalOutflow: 0,
        totalInflow: 0,
      },
    ]),
    getAccounts: vi.fn().mockResolvedValue([
      { name: "Account A", bankName: "Leumi", companyId: "leumi", fields: [], enabled: true, primary: true },
      { name: "Account B", bankName: "Hapoalim", companyId: "hapoalim", fields: [], enabled: false, primary: true },
      { name: "Account C", bankName: "Max", companyId: "max", fields: [], enabled: true, primary: true },
    ]),
  };
});

const SETTINGS_KEY = "scrape.settings.v1";

function renderPage() {
  return render(
    <ScrapeRunProvider>
      <ScrapePage />
    </ScrapeRunProvider>
  );
}

describe("Scrape tab", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(createScrapeStream).mockReset();
  });

  it("lists accounts first, with their type, last update, and last failure", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/Account A/)).toBeChecked());
    expect(screen.queryByLabelText(/Account B/)).not.toBeInTheDocument();
    expect(screen.getByText("Card")).toBeInTheDocument();
    expect(await screen.findByText(/Last try failed: Login page did not load/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update 2 accounts" })).toBeInTheDocument();
  });

  it("keeps every old option under Options, hydrated from localStorage", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ split: true, showBrowser: true, autoYnabImport: true, enableDetailedLogging: true, detailedLoggingLimit: 3, concurrency: 2, selectedAccounts: ["Account A"] })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    expect(screen.getByLabelText("Send to YNAB after scrape")).toHaveAttribute("data-state", "checked");
    expect(screen.getByLabelText("Show browser window")).toHaveAttribute("data-state", "checked");
    expect(screen.getByLabelText("Split CSV by account")).toHaveAttribute("data-state", "checked");
    expect(screen.getByLabelText("Detailed logging")).toHaveAttribute("data-state", "checked");
    expect((screen.getByLabelText("Log item limit (0 = all items)") as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("Accounts at the same time") as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText("Output folder") as HTMLInputElement).value).toMatch(/^\.\/output\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
    expect(await screen.findByRole("button", { name: "Update 1 account" })).toBeInTheDocument();
  });

  it("persists option changes back to localStorage", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    fireEvent.click(screen.getByLabelText("Split CSV by account"));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}").split).toBe(true));
  });

  it("starts from the last successful update − 3 days, and Retry runs only the failed account", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-10-20T12:00:00"));
    let send: (e: SSEEvent) => void = () => {};
    vi.mocked(createScrapeStream).mockImplementation((...args) => {
      send = args[7];
      return { close: vi.fn() } as unknown as EventSource;
    });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ selectedAccounts: ["Account A"] }));
      renderPage();
      expect(await screen.findByText(/From 12 Oct/)).toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: "Update 1 account" }));
      expect(vi.mocked(createScrapeStream).mock.calls[0][0]).toBe(8); // 12 Oct to 20 Oct
      expect(vi.mocked(createScrapeStream).mock.calls[0][5]).toEqual(["Account A"]);

      // Live steps come from the server's progress messages (which start with a newline).
      send({ type: "progress", message: "\nScraping Account A...", account: "Account A" });
      send({ type: "progress", message: "  [Account A] LOGGING_IN", account: "Account A" });
      expect(await screen.findByText("Logging in")).toBeInTheDocument();

      send({ type: "account-done", accountName: "Account A", success: false, error: "Login page did not load" });
      send({ type: "done", payload: { rows: [], skipped: [], summary: { byAccount: {}, totalOutflow: 0, totalInflow: 0 }, auditLog: {} } });
      expect(await screen.findByText("Account A failed. Retry it above.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(vi.mocked(createScrapeStream).mock.calls[1][5]).toEqual(["Account A"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows one summary line and the next actions after a run", async () => {
    localStorage.setItem(
      "scrape.payload.v1",
      JSON.stringify({ skipped: [], rows: [{ date: "2026-10-18", payee: "Shop", memo: "", outflow: "10", inflow: "" }], summary: { byAccount: {}, totalOutflow: 10, totalInflow: 0 } })
    );
    render(
      <ScrapeRunProvider>
        <ScrapePage openInbox={() => {}} />
      </ScrapeRunProvider>
    );
    expect(screen.getByText("1 new transaction")).toBeInTheDocument();
    for (const name of ["Categorize in Inbox", "Send to YNAB", "See transactions", "Log and CSV"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(await screen.findByText("14 new")).toBeInTheDocument(); // past updates
  });
});

function Harness({ show }: { show: boolean }) {
  return <ScrapeRunProvider>{show ? <ScrapePage /> : null}</ScrapeRunProvider>;
}

describe("Scrape run survives leaving the view", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps the run alive and does not close the stream when the page unmounts", async () => {
    const fakeStream = { close: vi.fn() };
    vi.mocked(createScrapeStream).mockReturnValue(fakeStream as unknown as EventSource);

    const { rerender } = render(<Harness show />);

    const update = await screen.findByRole("button", { name: /Update 2 accounts/ });
    fireEvent.click(update);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    rerender(<Harness show={false} />);
    expect(fakeStream.close).not.toHaveBeenCalled();

    rerender(<Harness show />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
