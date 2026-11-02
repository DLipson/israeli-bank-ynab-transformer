import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExportCard } from "@/components/ExportCard";
import { exportMonths } from "@/api/client";
import { monthLabel } from "@/lib/spending";
import { exploreControls } from "@/test/explore-controls";

vi.mock("@/api/client", () => ({ exportMonths: vi.fn() }));

// Today is 2 Nov 2026, so the last full month is 2026-10.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 2));
  vi.mocked(exportMonths).mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

const upTo = () => screen.getByLabelText("Up to") as HTMLSelectElement;
const months = () => screen.getByLabelText("Months") as HTMLSelectElement;
const choose = (select: HTMLSelectElement, value: string) => fireEvent.change(select, { target: { value } });
const exportNow = () => fireEvent.click(screen.getByRole("button", { name: "Export" }));
const anyDisabled = () => [...upTo().options, ...months().options].some((o) => o.disabled);

describe("Export months", () => {
  it("exports the last full month by default", async () => {
    render(<ExportCard />);
    exportNow();
    await waitFor(() => expect(exportMonths).toHaveBeenCalledWith("2026-10", "2026-10"));
  });

  it("exports 3 months ending at the last full month", async () => {
    render(<ExportCard />);
    choose(months(), "3");
    exportNow();
    await waitFor(() => expect(exportMonths).toHaveBeenCalledWith("2026-08", "2026-10"));
  });

  it("crosses a year boundary", async () => {
    render(<ExportCard />);
    choose(upTo(), "2026-02");
    choose(months(), "3");
    exportNow();
    await waitFor(() => expect(exportMonths).toHaveBeenCalledWith("2025-12", "2026-02"));
  });

  it("gives the same result in either order", async () => {
    const first = render(<ExportCard />);
    choose(months(), "3");
    choose(upTo(), "2026-02");
    exportNow();
    await waitFor(() => expect(exportMonths).toHaveBeenCalledWith("2025-12", "2026-02"));
    first.unmount();
    vi.mocked(exportMonths).mockClear();
    render(<ExportCard />);
    choose(upTo(), "2026-02");
    choose(months(), "3");
    exportNow();
    await waitFor(() => expect(exportMonths).toHaveBeenCalledWith("2025-12", "2026-02"));
  });

  it("never disables an option", () => {
    render(<ExportCard />);
    expect(anyDisabled()).toBe(false);
    choose(upTo(), "2026-02");
    expect(anyDisabled()).toBe(false);
    choose(months(), "24");
    expect(anyDisabled()).toBe(false);
    expect(upTo().options).toHaveLength(36);
  });

  it("lets the user pick the current month, marked as partial", async () => {
    render(<ExportCard />);
    const current = [...upTo().options].find((o) => o.value === "2026-11")!;
    expect(current.text).toContain("(so far)");
    choose(upTo(), "2026-11");
    exportNow();
    await waitFor(() => expect(exportMonths).toHaveBeenCalledWith("2026-11", "2026-11"));
  });

  it("shows the resolved range", () => {
    render(<ExportCard />);
    expect(screen.getByTestId("export-range")).toHaveTextContent(monthLabel("2026-10"));
    choose(months(), "3");
    expect(screen.getByTestId("export-range")).toHaveTextContent(`${monthLabel("2026-08")} – ${monthLabel("2026-10")}`);
  });

  it("shows the server error and lets the user try again", async () => {
    vi.mocked(exportMonths).mockRejectedValue(new Error("boom"));
    render(<ExportCard />);
    exportNow();
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });

  it("keeps its controls independent (explore every value and pair)", async () => {
    await exploreControls(<ExportCard />);
  }, 120_000);
});
