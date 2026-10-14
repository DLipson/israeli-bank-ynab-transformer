import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const APP_CONFIG_DIR_NAME = "israeli-bank-ynab-transformer";
const CONFIG_DIR_OVERRIDE_ENV = "ISRAELI_BANK_YNAB_CONFIG_DIR";

/**
 * Config-location helpers. Kept dependency-free so modules that need a path
 * (e.g. the account-instance store) never import `env.ts` and create a cycle.
 */
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

export function getYnabImportConfigPath(): string {
  return join(getAppConfigDir(), "ynab-import.json");
}

export function getAccountsConfigPath(): string {
  return join(getAppConfigDir(), "accounts.json");
}

export function getHistoryDir(): string {
  return join(getAppConfigDir(), "history");
}

export function ensureAppConfigDirExists(): string {
  const dir = getAppConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
