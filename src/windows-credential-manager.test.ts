import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnSync = vi.fn();
vi.mock("node:child_process", () => ({ spawnSync }));
vi.mock("node:fs", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs")>()), existsSync: () => true }));

const { hydrateEnvWithStoredBankCredentials, YNAB_TOKEN_ENV_VAR } = await import("./windows-credential-manager.js");

describe("hydrateEnvWithStoredBankCredentials", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    spawnSync.mockReset();
    Object.defineProperty(process, "platform", { value: "win32" });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, "platform", platform);
    delete process.env[YNAB_TOKEN_ENV_VAR];
  });

  it("retries a failed read after a minute, not before, and stops after a good read", () => {
    spawnSync.mockReturnValue({ status: 1, stderr: "broken" });
    hydrateEnvWithStoredBankCredentials();
    const failedCalls = spawnSync.mock.calls.length;
    expect(failedCalls).toBeGreaterThan(0);

    vi.setSystemTime(1_000_000 + 59_000);
    hydrateEnvWithStoredBankCredentials();
    expect(spawnSync).toHaveBeenCalledTimes(failedCalls);

    spawnSync.mockReturnValue({ status: 0, stdout: JSON.stringify({ "israeli-bank-ynab-transformer:YNAB_API_TOKEN": "tok" }) });
    vi.setSystemTime(1_000_000 + 61_000);
    hydrateEnvWithStoredBankCredentials();
    expect(process.env[YNAB_TOKEN_ENV_VAR]).toBe("tok");
    const okCalls = spawnSync.mock.calls.length;

    vi.setSystemTime(1_000_000 + 10 * 60_000);
    hydrateEnvWithStoredBankCredentials();
    expect(spawnSync).toHaveBeenCalledTimes(okCalls);
  });
});
