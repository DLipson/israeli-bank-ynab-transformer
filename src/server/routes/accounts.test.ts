import express from "express";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../windows-credential-manager.js", () => ({
  deleteBankCredentialsFromWindowsCredentialManager: vi.fn(),
  hydrateEnvWithStoredBankCredentials: vi.fn(),
  isWindowsCredentialManagerAvailable: vi.fn(() => false),
  saveBankCredentialsToWindowsCredentialManager: vi.fn(),
}));

const { default: accountsRouter } = await import("./accounts.js");

const OVERRIDE_ENV = "ISRAELI_BANK_YNAB_CONFIG_DIR";
const createdDirs: string[] = [];

afterEach(() => {
  delete process.env[OVERRIDE_ENV];
  delete process.env.LEUMI_USERNAME;
  delete process.env.LEUMI_PASSWORD;

  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ibyt-accounts-"));
  createdDirs.push(dir);
  process.env[OVERRIDE_ENV] = dir;
  return dir;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/accounts", accountsRouter);
  return app;
}

async function putJson(path: string, body: unknown): Promise<Response> {
  const server = createApp().listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    server.close();
  }
}

describe("accounts credentials route", () => {
  it("updates one credential field while preserving existing fields", async () => {
    const configDir = createTempConfigDir();
    const envPath = join(configDir, ".env");
    writeFileSync(envPath, "LEUMI_USERNAME=existing-user\nLEUMI_PASSWORD=old-password\n", "utf-8");

    const response = await putJson("/api/accounts/Leumi/credentials", {
      credentials: {
        username: "",
        password: "new-password",
      },
    });

    expect(response.status).toBe(200);
    expect(readFileSync(envPath, "utf-8")).toBe(
      "LEUMI_USERNAME=existing-user\nLEUMI_PASSWORD=new-password\n"
    );
  });
});
