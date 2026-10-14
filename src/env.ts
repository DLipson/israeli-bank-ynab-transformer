import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";
import { hydrateEnvWithStoredBankCredentials } from "./windows-credential-manager.js";
import { getEnvFilePath } from "./paths.js";

export {
  getAppConfigDir,
  getEnvFilePath,
  getCategoryReportConfigPath,
  getYnabImportConfigPath,
  getAccountsConfigPath,
  getHistoryDir,
  ensureAppConfigDirExists,
} from "./paths.js";

export interface LoadAppEnvOptions {
  override?: boolean;
}

export function loadAppEnv(options: LoadAppEnvOptions = {}): string {
  const envPath = getEnvFilePath();

  // Load stored bank credentials before dotenv so .env stays a fallback for missing values.
  hydrateEnvWithStoredBankCredentials();

  if (existsSync(envPath)) {
    const parsed = dotenv.parse(readFileSync(envPath, "utf-8"));
    const override = options.override ?? false;

    for (const [key, value] of Object.entries(parsed)) {
      if (!override && process.env[key] !== undefined) {
        continue;
      }

      if (override && value === "" && process.env[key]) {
        continue;
      }

      process.env[key] = value;
    }
  }

  return envPath;
}
