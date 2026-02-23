import { describe, expect, it } from "vitest";
import { getLocalHour, shouldRunAtLocalHour } from "./schedule.js";

describe("getLocalHour", () => {
  it("resolves Jerusalem winter hour from UTC", () => {
    const hour = getLocalHour(new Date("2026-02-17T05:00:00.000Z"), "Asia/Jerusalem");
    expect(hour).toBe(7);
  });

  it("resolves Jerusalem summer hour from UTC", () => {
    const hour = getLocalHour(new Date("2026-06-17T04:00:00.000Z"), "Asia/Jerusalem");
    expect(hour).toBe(7);
  });
});

describe("shouldRunAtLocalHour", () => {
  it("returns true when current local hour matches target", () => {
    const shouldRun = shouldRunAtLocalHour(
      new Date("2026-02-17T05:00:00.000Z"),
      "Asia/Jerusalem",
      7
    );
    expect(shouldRun).toBe(true);
  });

  it("returns false when local hour does not match target", () => {
    const shouldRun = shouldRunAtLocalHour(
      new Date("2026-02-17T04:00:00.000Z"),
      "Asia/Jerusalem",
      7
    );
    expect(shouldRun).toBe(false);
  });
});
