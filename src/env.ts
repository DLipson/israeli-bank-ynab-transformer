import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import dotenv from "dotenv";

const APP_CONFIG_DIR_NAME = "israeli-bank-ynab-transformer";
const CONFIG_DIR_OVERRIDE_ENV = "ISRAELI_BANK_YNAB_CONFIG_DIR";

export function getAppConfigDir(): string {
  const override = process.env[CONFIG_DIR_OVERRIDE_ENV]?.trim();
  if (override) {
    return resolve(override);
  }
  return join(homedir(), ".config", APP_CONFIG_DIR_NAME);
}

export function getEnvFilePath(): string {
  return join(getAppConfigDir(), ".env");
}

export function getCategoryReportConfigPath(): string {
  return join(getAppConfigDir(), "category-report.json");
}

export function ensureAppConfigDirExists(): string {
  const dir = getAppConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function loadAppEnv(): string {
  const envPath = getEnvFilePath();

  const result = dotenv.config({ path: envPath });
  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;
    if (error.code !== "ENOENT") {
      throw result.error;
    }
  }
  return envPath;
}
