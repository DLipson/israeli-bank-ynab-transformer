import express from "express";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ynabRequest = vi.fn();
vi.mock("../../ynab/import-service.js", () => ({
  getYnabToken: () => "token",
  loadYnabImportConfig: () => ({ budgetId: "b", mappings: [] }),
  ynabRequest,
}));

const setCategory = vi.fn();
vi.mock("../../ynab/categorize-service.js", () => ({ setCategory }));
const cached = [
  { id: "back", date: "2026-10-08", amount: 300_000, payee_name: "Shoe shop", category_id: null, category_name: null, account_id: "c", account_name: "Card", transfer_account_id: null, memo: null, deleted: false },
  { id: "shoes", date: "2026-09-20", amount: -300_000, payee_name: "Shoe shop", category_id: "clothing", category_name: "Clothing", account_id: "c", account_name: "Card", transfer_account_id: null, memo: null, deleted: false },
  { id: "split", date: "2026-09-21", amount: -100_000, payee_name: "Market", category_id: null, category_name: "Split", account_id: "c", account_name: "Card", transfer_account_id: null, memo: null, deleted: false, subtransactions: [{ amount: -50_000, category_id: "a" }, { amount: -50_000, category_id: "b" }] },
  { id: "old", date: "2026-05-01", amount: -100_000, payee_name: "Old shop", category_id: "clothing", category_name: "Clothing", account_id: "c", account_name: "Card", transfer_account_id: null, memo: null, deleted: false },
];
vi.mock("../../ynab/transaction-cache.js", () => ({ getAllTransactions: async () => cached }));

vi.mock("../../windows-credential-manager.js", () => ({
  deleteBankCredentialsFromWindowsCredentialManager: vi.fn(),
  hydrateEnvWithStoredBankCredentials: vi.fn(),
  isWindowsCredentialManagerAvailable: vi.fn(() => false),
  saveBankCredentialsToWindowsCredentialManager: vi.fn(),
}));

const { default: spendingRouter } = await import("./spending.js");

const OVERRIDE_ENV = "ISRAELI_BANK_YNAB_CONFIG_DIR";
let dir = "";

const CATEGORIES = [
  { id: "food", name: "Food", hidden: false, deleted: false, category_group_name: "Everyday", budgeted: 0, activity: 0, balance: 0 },
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ibyt-spending-"));
  process.env[OVERRIDE_ENV] = dir;
  ynabRequest.mockReset();
  ynabRequest.mockImplementation(async (_token: string, path: string, init?: RequestInit) => {
    if (path === "/budgets/b/months/current") return { month: { month: "2026-10-01", to_be_budgeted: 0, categories: CATEGORIES } };
    if (path === "/budgets/b/scheduled_transactions" && init?.method === "POST") return { scheduled_transaction: { id: "new-s" } };
    if (path.startsWith("/budgets/b/scheduled_transactions/") && init?.method === "DELETE") return { scheduled_transaction: { id: "new-s" } };
    throw new Error(`unexpected YNAB call ${init?.method ?? "GET"} ${path}`);
  });
});

afterEach(() => {
  delete process.env[OVERRIDE_ENV];
  rmSync(dir, { recursive: true, force: true });
});

function saved(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "safe-spending.json"), "utf-8"));
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const app = express();
  app.use(express.json());
  app.use("/api/spending", spendingRouter);
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/spending${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

describe("spending settings validation", () => {
  it("saves valid new settings", async () => {
    const result = await call("PUT", "/settings", {
      payday: 10,
      essentialCategoryIds: ["food"],
      essentialsOverride: { period: "2026-11-09", amounts: { food: 500_000 } },
      cardWarningLevel: 2_000_000,
    });
    expect(result.status).toBe(200);
    expect(saved()).toMatchObject({
      payday: 10,
      essentialCategoryIds: ["food"],
      essentialsOverride: { period: "2026-11-09", amounts: { food: 500_000 } },
      cardWarningLevel: 2_000_000,
    });
  });

  it.each([
    ["a negative warning level", { cardWarningLevel: -1 }],
    ["a negative buffer", { buffer: -1 }],
    ["an unknown essential category", { essentialCategoryIds: ["nope"] }],
    ["an override with no period", { essentialsOverride: { amounts: { food: 1 } } }],
    ["an override with an unknown category", { essentialsOverride: { period: "2026-10-31", amounts: { nope: 1 } } }],
    ["a negative override amount", { essentialsOverride: { period: "2026-10-31", amounts: { food: -1 } } }],
  ])("rejects %s", async (_name, body) => {
    const result = await call("PUT", "/settings", body);
    expect(result.status).toBe(400);
  });

  it("does not let the client set createdScheduleIds", async () => {
    await call("PUT", "/settings", { createdScheduleIds: ["user-made"] });
    expect(saved().createdScheduleIds).toEqual([]);
  });
});

describe("Inbox undo endpoints", () => {
  it("restores a dismissed anomaly and an ignored suggestion", async () => {
    writeFileSync(join(dir, "safe-spending.json"), JSON.stringify({ dismissedAnomalies: ["a|1", "a|2"], ignoredSuggestions: ["acc|x"] }));
    expect((await call("POST", `/anomalies/${encodeURIComponent("a|1")}/restore`)).status).toBe(200);
    expect((await call("POST", `/suggestions/${encodeURIComponent("acc|x")}/restore`)).status).toBe(200);
    expect(saved()).toMatchObject({ dismissedAnomalies: ["a|2"], ignoredSuggestions: [] });
  });

  it("deletes only a schedule that the app created", async () => {
    const created = await call("POST", "/scheduled", { accountId: "acc", date: "2099-01-01", amount: 30_000, payeeName: "Rescue", categoryId: null });
    expect(created).toMatchObject({ status: 200, json: { id: "new-s" } });
    expect(saved().createdScheduleIds).toEqual(["new-s"]);

    const refused = await call("DELETE", "/scheduled/user-made");
    expect(refused.status).toBe(400);
    expect(ynabRequest).not.toHaveBeenCalledWith("token", "/budgets/b/scheduled_transactions/user-made", expect.anything());

    const deleted = await call("DELETE", "/scheduled/new-s");
    expect(deleted.status).toBe(200);
    expect(ynabRequest).toHaveBeenCalledWith("token", "/budgets/b/scheduled_transactions/new-s", { method: "DELETE" });
    expect(saved().createdScheduleIds).toEqual([]);
  });
});

describe("Treat as refund", () => {
  it("lists recent purchases that can be picked: categorized, not split, last 90 days, newest first", async () => {
    const result = await call("GET", "/purchases?today=2026-10-20");
    expect((result.json.purchases as Array<{ id: string }>).map((p) => p.id)).toEqual(["shoes"]);
  });

  it("sets the refund's YNAB category to the purchase's category and saves the link", async () => {
    setCategory.mockReset();
    const result = await call("POST", "/refund", { refundTxId: "back", purchaseTxId: "shoes" });
    expect(result.status).toBe(200);
    expect(setCategory).toHaveBeenCalledWith("token", "back", "clothing");
    expect(saved().refundLinks).toEqual([{ refundTxId: "back", purchaseTxId: "shoes" }]);
  });

  it.each([
    ["a purchase as the refund", { refundTxId: "shoes", purchaseTxId: "shoes" }],
    ["a split purchase", { refundTxId: "back", purchaseTxId: "split" }],
    ["an unknown transaction", { refundTxId: "nope", purchaseTxId: "shoes" }],
  ])("refuses %s and writes nothing", async (_name, body) => {
    setCategory.mockReset();
    expect((await call("POST", "/refund", body)).status).toBe(400);
    expect(setCategory).not.toHaveBeenCalled();
  });
});
