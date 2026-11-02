import { describe, it, expect } from "vitest";
import { exportRange, lastFullMonth, recentMonths } from "@/lib/export-range";

describe("export range", () => {
  it("one month is just that month", () => {
    expect(exportRange("2026-10", 1)).toEqual({ from: "2026-10", to: "2026-10" });
  });
  it("crosses a year boundary", () => {
    expect(exportRange("2026-02", 3)).toEqual({ from: "2025-12", to: "2026-02" });
  });
  it("12 months ends at the chosen month", () => {
    expect(exportRange("2026-10", 12)).toEqual({ from: "2025-11", to: "2026-10" });
  });
  it("last full month in January is December", () => {
    expect(lastFullMonth(new Date(2026, 0, 15))).toBe("2025-12");
  });
  it("lists recent months newest first", () => {
    expect(recentMonths(new Date(2026, 10, 2), 3)).toEqual(["2026-11", "2026-10", "2026-09"]);
  });
});
