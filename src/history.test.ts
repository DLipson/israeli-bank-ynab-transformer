import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRun, listRuns, saveRun, updateRun } from "./history.js";

const DAY = 24 * 60 * 60 * 1000;
const input = {
  settings: { daysBack: 30, accounts: ["Max"] },
  accounts: [{ accountName: "Max", success: true, transactionCount: 2 }],
  payload: {
    rows: [{}, {}],
    skipped: [],
    summary: { byAccount: {}, totalOutflow: 50, totalInflow: 10 },
    auditLog: {},
  },
};

describe("scrape history", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "history-test-"));
    process.env.ISRAELI_BANK_YNAB_CONFIG_DIR = dir;
  });

  afterEach(() => {
    delete process.env.ISRAELI_BANK_YNAB_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves, lists newest first, and records later exports", () => {
    const first = saveRun(input, 1_000 * DAY);
    const second = saveRun(input, 1_001 * DAY);
    updateRun(first, (run) => run.exports.push({ at: "x", csvPaths: ["a.csv"], auditLogPath: "a.log" }));

    const runs = listRuns();
    expect(runs.map((r) => r.id)).toEqual([second, first]);
    expect(runs[0]).toMatchObject({ rowCount: 2, totalOutflow: 50, totalInflow: 10 });
    expect(runs[0]).not.toHaveProperty("payload");
    expect(getRun(first)?.exports[0].csvPaths).toEqual(["a.csv"]);
  });

  it("deletes runs older than 90 days on save", () => {
    const old = saveRun(input, 1_000 * DAY);
    saveRun(input, 1_091 * DAY);
    expect(getRun(old)).toBeNull();
    expect(listRuns()).toHaveLength(1);
  });

  it("rejects ids that are not run ids", () => {
    expect(() => getRun("../.env")).toThrow("Invalid run id");
  });
});
