import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureAppConfigDirExists,
  getAppConfigDir,
  getCategoryReportConfigPath,
  getEnvFilePath,
  loadAppEnv,
} from "./env.js";

const OVERRIDE_ENV = "ISRAELI_BANK_YNAB_CONFIG_DIR";
const TEST_KEY = "ENV_TEST_KEY";

const createdDirs: string[] = [];

afterEach(() => {
  delete process.env[OVERRIDE_ENV];
  delete process.env[TEST_KEY];

  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ibyt-env-"));
  createdDirs.push(dir);
  return dir;
}

describe("env paths", () => {
  it("uses override config directory when provided", () => {
    const dir = createTempConfigDir();
    process.env[OVERRIDE_ENV] = dir;

    expect(getAppConfigDir()).toBe(dir);
    expect(getEnvFilePath()).toBe(join(dir, ".env"));
    expect(getCategoryReportConfigPath()).toBe(join(dir, "category-report.json"));
  });

  it("creates config directory and loads env file", () => {
    const dir = createTempConfigDir();
    process.env[OVERRIDE_ENV] = join(dir, "config");

    const configDir = ensureAppConfigDirExists();
    const envPath = join(configDir, ".env");
    writeFileSync(envPath, `${TEST_KEY}=loaded\n`, "utf-8");

    loadAppEnv();

    expect(process.env[TEST_KEY]).toBe("loaded");
  });
});
