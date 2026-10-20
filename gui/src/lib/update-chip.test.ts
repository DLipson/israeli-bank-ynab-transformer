import { describe, expect, it } from "vitest";
import { chipView, daysBackFrom, savedRunParams } from "@/lib/update-chip";

const now = new Date("2026-10-20T10:00:00");

describe("savedRunParams", () => {
  it("uses the saved options, and the last update − 3 days as the start", () => {
    const params = savedRunParams(
      { showBrowser: true, concurrency: 2, autoYnabImport: true, selectedAccounts: ["Leumi", "Old"], daysBack: 60 },
      ["Leumi", "Max"],
      "2026-10-15T08:00:00",
      now
    );
    expect(params).toMatchObject({ showBrowser: true, concurrency: 2, autoYnabImport: true, selectedAccounts: ["Leumi"], daysBack: 8 });
  });

  it("selects every enabled account and the saved days back when nothing else is known", () => {
    expect(savedRunParams({ daysBack: 30 }, ["Leumi", "Max"], null, now)).toMatchObject({
      selectedAccounts: ["Leumi", "Max"],
      daysBack: 30,
      autoYnabImport: false,
    });
  });

  it("counts days back from the local start of the day", () => {
    expect(daysBackFrom("2026-10-20T01:00:00", now)).toBe(3);
  });
});

describe("chipView", () => {
  const base = { phase: "settings" as const, accountStatuses: [], error: "", ranHere: false, now };

  it("shows the age of the data, orange at 3 days or more", () => {
    expect(chipView({ ...base, lastScrapedAt: "2026-10-16T09:00:00" })).toEqual({ text: "Updated 4 days ago", tone: "warning", opensScrape: false });
    expect(chipView({ ...base, lastScrapedAt: "2026-10-18T09:00:00" })).toEqual({ text: "Updated 2 days ago", tone: "muted", opensScrape: false });
    expect(chipView({ ...base, lastScrapedAt: "2026-10-20T07:00:00" }).text).toBe("Updated 3 hours ago");
    expect(chipView({ ...base, lastScrapedAt: null })).toEqual({ text: "Never updated", tone: "warning", opensScrape: false });
  });

  it("shows progress while a run is going", () => {
    const view = chipView({
      ...base,
      lastScrapedAt: null,
      phase: "progress",
      accountStatuses: [
        { name: "Leumi", status: "done" },
        { name: "Max", status: "scraping" },
        { name: "Cal", status: "pending" },
      ],
    });
    expect(view).toEqual({ text: "Updating 1 of 3", tone: "running", opensScrape: true });
  });

  it("after a run started here, shows success or the failed accounts", () => {
    const done = { ...base, lastScrapedAt: null, phase: "results" as const, ranHere: true };
    expect(chipView({ ...done, accountStatuses: [{ name: "Leumi", status: "done" }] })).toEqual({ text: "Updated just now", tone: "success", opensScrape: true });
    expect(chipView({ ...done, accountStatuses: [{ name: "Leumi", status: "done" }, { name: "Max", status: "failed" }] })).toEqual({
      text: "Max failed",
      tone: "danger",
      opensScrape: true,
    });
    expect(chipView({ ...done, error: "Network down" })).toEqual({ text: "Update failed", tone: "danger", opensScrape: true });
  });
});
