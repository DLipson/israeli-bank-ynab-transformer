import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { YnabPage } from "@/pages/YnabPage";
import { SpendingProvider } from "@/pages/SpendingPage";
import { ScrapeRunProvider } from "@/components/ScrapeRunProvider";
import { getYnabAccounts, getYnabBudgets, getYnabImportConfig, getYnabTokenStatus, saveYnabImportConfig } from "@/api/client";
import { exploreControls } from "@/test/explore-controls";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/api/client");
  return {
    ...actual,
    getYnabImportConfig: vi.fn(),
    getYnabTokenStatus: vi.fn(),
    getYnabBudgets: vi.fn(),
    getYnabAccounts: vi.fn(),
    saveYnabImportConfig: vi.fn(),
    saveYnabToken: vi.fn().mockResolvedValue({ saved: true }),
  };
});

beforeEach(() => {
  vi.mocked(getYnabImportConfig).mockResolvedValue({ budgetId: "b1", mappings: { Leumi: "", Max: "a1" } });
  vi.mocked(getYnabTokenStatus).mockResolvedValue({ saved: true });
  vi.mocked(getYnabBudgets).mockResolvedValue([
    { id: "b1", name: "Family" },
    { id: "b2", name: "Business" },
  ]);
  vi.mocked(getYnabAccounts).mockResolvedValue([
    { id: "a1", name: "Checking" },
    { id: "a2", name: "Card" },
  ]);
  vi.mocked(saveYnabImportConfig).mockImplementation(async (config) => config);
});

const page = (
  <SpendingProvider>
    <ScrapeRunProvider>
      <YnabPage />
    </ScrapeRunProvider>
  </SpendingProvider>
);

describe("YNAB page", () => {
  it("shows the token, the budget and one mapping per source", async () => {
    render(page);
    expect(await screen.findByText("YNAB Import")).toBeInTheDocument();
    expect(screen.getByText("(saved)")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Family" })).toBeInTheDocument();
    expect((await screen.findAllByRole("option", { name: "Checking" })).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Budget")).toHaveValue("b1");
    expect(screen.getByLabelText("Max")).toHaveValue("a1");
    expect(screen.getByLabelText("Leumi")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("lets the user go back to no budget, which disables the mapping selects", async () => {
    render(page);
    const budget = await screen.findByLabelText("Budget");
    await screen.findByRole("option", { name: "Family" });
    expect(budget).toHaveValue("b1");
    expect(screen.getByLabelText("Max")).toBeEnabled();
    fireEvent.change(budget, { target: { value: "" } });
    expect(budget).toHaveValue("");
    expect(screen.getByRole("option", { name: "Select a budget" })).toBeInTheDocument();
    expect(screen.getByLabelText("Max")).toBeDisabled();
    expect(screen.getByLabelText("Leumi")).toBeDisabled();
  });

  it("keeps its controls independent", async () => {
    // On purpose (a comment in the page says so): account ids belong to one budget, so a new budget clears every mapping.
    await exploreControls(page, {
      maxRuns: 60,
      coupled: [["Budget", "Leumi"], ["Budget", "Max"]],
      // The mapping selects need a budget. The Budget select needs a saved token, but the token is not a control
      // the harness sees (the token field is a text box), so that one is not declared; the token is saved here.
      requires: [["Leumi", "Budget"], ["Max", "Budget"]],
    });
  }, 30_000);
});
