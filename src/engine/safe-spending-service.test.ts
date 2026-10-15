import { describe, expect, it } from "vitest";
import { lastSuccessfulScrapeAt } from "./safe-spending-service.js";

describe("lastSuccessfulScrapeAt", () => {
  it("uses the newest fully successful scrape", () => {
    const runs = [
      {
        createdAt: "2026-10-15T09:00:00.000Z",
        accounts: [
          { accountName: "Checking", success: true, transactionCount: 3 },
          { accountName: "Card", success: false, transactionCount: 0 },
        ],
      },
      {
        createdAt: "2026-10-14T09:00:00.000Z",
        accounts: [{ accountName: "Checking", success: true, transactionCount: 2 }],
      },
    ];
    expect(lastSuccessfulScrapeAt(runs)).toBe("2026-10-14T09:00:00.000Z");
  });

  it("returns null when no successful run is recorded", () => {
    expect(lastSuccessfulScrapeAt([])).toBeNull();
    expect(lastSuccessfulScrapeAt([{ createdAt: "2026-10-15T09:00:00.000Z", accounts: [] }])).toBeNull();
  });
});
