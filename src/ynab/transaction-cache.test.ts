import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let writes = 0;
const ynabRequest = vi.fn(async () => ({ transactions: [], server_knowledge: 1 }));
vi.mock("./import-service.js", () => ({ ynabRequest, ynabWrites: () => writes }));

const { getAllTransactions } = await import("./transaction-cache.js");

describe("getAllTransactions reuse", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ibyt-cache-"));
    process.env.ISRAELI_BANK_YNAB_CONFIG_DIR = dir;
    ynabRequest.mockClear();
    writes = 0;
  });
  afterEach(() => {
    delete process.env.ISRAELI_BANK_YNAB_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("shares one YNAB read between callers for a minute, and reads again after a write or when asked", async () => {
    await Promise.all([getAllTransactions("t", "b1"), getAllTransactions("t", "b1")]);
    const first = ynabRequest.mock.calls.length;
    expect(first).toBe(1); // first download: one request, shared by both callers
    await getAllTransactions("t", "b1");
    expect(ynabRequest.mock.calls.length).toBe(first);
    writes = 1;
    await getAllTransactions("t", "b1");
    expect(ynabRequest.mock.calls.length).toBeGreaterThan(first);
    const afterWrite = ynabRequest.mock.calls.length;
    await getAllTransactions("t", "b1", { fresh: true });
    expect(ynabRequest.mock.calls.length).toBeGreaterThan(afterWrite);
  });
});
