import { describe, expect, it } from "vitest";
import { nextEssentialsOverride } from "@/lib/spending";

describe("nextEssentialsOverride", () => {
  it("adds one category to this period's override and keeps the others", () => {
    expect(nextEssentialsOverride({ period: "2026-10-31", amounts: { fuel: 900 } }, "2026-10-31", "food", 500)).toEqual({
      period: "2026-10-31",
      amounts: { fuel: 900, food: 500 },
    });
  });

  it("starts a new override when the saved one is for an old period", () => {
    expect(nextEssentialsOverride({ period: "2026-09-30", amounts: { fuel: 900 } }, "2026-10-31", "food", 500)).toEqual({
      period: "2026-10-31",
      amounts: { food: 500 },
    });
    expect(nextEssentialsOverride(null, "2026-10-31", "food", 0)).toEqual({ period: "2026-10-31", amounts: { food: 0 } });
  });
});
