import express from "express";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

const setCategory = vi.fn();
vi.mock("../../ynab/categorize-service.js", () => ({
  getCategorizeList: vi.fn(),
  getLlmSuggestions: vi.fn(),
  saveRejection: vi.fn(),
  setCategory,
}));
vi.mock("../../ynab/import-service.js", () => ({ getYnabToken: () => "token" }));
vi.mock("../../windows-credential-manager.js", () => ({
  hydrateEnvWithStoredBankCredentials: vi.fn(),
  isWindowsCredentialManagerAvailable: vi.fn(() => false),
  saveBankCredentialsToWindowsCredentialManager: vi.fn(),
  SERPER_KEY_ENV_VAR: "SERPER_API_KEY",
}));

const { default: categorizeRouter } = await import("./categorize.js");

async function accept(body: unknown): Promise<number> {
  const app = express();
  app.use(express.json());
  app.use("/api/categorize", categorizeRouter);
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/categorize/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.status;
  } finally {
    server.close();
  }
}

describe("categorize accept", () => {
  it("sets a category, or clears it with null for Inbox Undo", async () => {
    expect(await accept({ id: "t1", categoryId: "food" })).toBe(200);
    expect(setCategory).toHaveBeenLastCalledWith("token", "t1", "food");
    expect(await accept({ id: "t1", categoryId: null })).toBe(200);
    expect(setCategory).toHaveBeenLastCalledWith("token", "t1", null);
    expect(await accept({ id: "t1" })).toBe(500);
  });
});
