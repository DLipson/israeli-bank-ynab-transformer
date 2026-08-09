import { describe, expect, it } from "vitest";
import { getLocalHour } from "./schedule.js";

describe("getLocalHour", () => {
  it("resolves Jerusalem winter hour from UTC", () => {
    expect(getLocalHour(new Date("2026-02-17T05:00:00.000Z"), "Asia/Jerusalem")).toBe(7);
  });

  it("resolves Jerusalem summer hour from UTC", () => {
    expect(getLocalHour(new Date("2026-06-17T04:00:00.000Z"), "Asia/Jerusalem")).toBe(7);
  });
});
