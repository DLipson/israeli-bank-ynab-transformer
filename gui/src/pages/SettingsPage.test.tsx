import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SettingsPage } from "@/pages/SettingsPage";
import { SpendingProvider } from "@/pages/SpendingPage";
import { getSpending, saveSpendingSettings, getInflows, type SpendingSettings } from "@/api/client";
import { spendingFixture, settingsFixture } from "@/test/fixtures";
import { exploreControls } from "@/test/explore-controls";

// A small fake server: saving settings changes what the next read returns, as the real server does.
let settings: SpendingSettings;
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/api/client");
  return {
    ...actual,
    getSpending: vi.fn(),
    saveSpendingSettings: vi.fn(),
    getInflows: vi.fn(),
    setIncomeMark: vi.fn().mockResolvedValue(undefined),
  };
});

function setup() {
  localStorage.clear();
  settings = settingsFixture();
  vi.mocked(getSpending).mockImplementation(async () => spendingFixture({ settings }));
  vi.mocked(saveSpendingSettings).mockImplementation(async (patch) => {
    settings = { ...settings, ...patch };
    return settings;
  });
  vi.mocked(getInflows).mockResolvedValue([
    { id: "i1", date: "2026-10-20", payee: "Salary", account: "Checking", category: null, transfer: false, amount: 9_000_000, mark: null },
  ]);
}

const page = (view = "main") => (
  <SpendingProvider>
    <SettingsPage view={view} setView={() => {}} />
  </SpendingProvider>
);

describe("Settings page", () => {
  it("shows the settings with the saved values", async () => {
    setup();
    render(page());
    expect(await screen.findByText("Everyday essentials")).toBeInTheDocument();
    expect(screen.getByText("Buffer")).toBeInTheDocument();
    expect(screen.getByLabelText("Buffer")).toHaveValue(500);
    expect(screen.getByLabelText("Payday")).toHaveValue("month-start");
    expect(screen.getByText("Groceries")).toBeInTheDocument();
  });

  it("saves the payday and shows the new value", async () => {
    setup();
    render(page());
    const payday = await screen.findByLabelText("Payday");
    fireEvent.change(payday, { target: { value: "10" } });
    await waitFor(() => expect(screen.getByLabelText("Payday")).toHaveValue("10"));
    expect(saveSpendingSettings).toHaveBeenCalledWith({ payday: 10 });
  });

  it("lists money in and the mark of each entry", async () => {
    setup();
    render(page("income"));
    expect(await screen.findByText("Salary")).toBeInTheDocument();
    expect(screen.getByLabelText("Income mark for Salary")).toHaveValue("");
  });

  it("shows the Saved message after a change", async () => {
    setup();
    render(page());
    fireEvent.change(await screen.findByLabelText("Payday"), { target: { value: "10" } });
    expect(await screen.findByText(/Saved\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Payday")).toHaveValue("10"));
    expect(screen.getByText(/Saved\./)).toBeInTheDocument();
  });

  it("keeps the card limits section open when another setting is saved", async () => {
    setup();
    render(page());
    const toggle = await screen.findByRole("button", { name: /Card limits/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.change(screen.getByLabelText("Payday"), { target: { value: "10" } });
    await waitFor(() => expect(screen.getByLabelText("Payday")).toHaveValue("10"));
    expect(screen.getByRole("button", { name: /Card limits/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps text typed in the essentials search when another setting is saved", async () => {
    setup();
    render(page());
    fireEvent.change(await screen.findByLabelText("Everyday essentials"), { target: { value: "fun" } });
    fireEvent.change(screen.getByLabelText("Payday"), { target: { value: "10" } });
    await waitFor(() => expect(screen.getByLabelText("Payday")).toHaveValue("10"));
    expect(screen.getByLabelText("Everyday essentials")).toHaveValue("fun");
  });

  it("keeps its controls independent (main view)", async () => {
    setup();
    await exploreControls(page(), { maxRuns: 60 });
  }, 30_000);

  it("keeps its controls independent (income view)", async () => {
    setup();
    // The search box filters the list on purpose: typing in it removes the rows (and their mark selects) that do not match.
    await exploreControls(page("income"), { maxRuns: 60, coupled: [["Search money in", "Income mark for Salary"]] });
  }, 30_000);
});
