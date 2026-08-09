import { CompanyTypes } from "israeli-bank-scrapers";
import { BANK_DEFINITIONS } from "./banks.js";
import { getEnvFilePath } from "./env.js";

export interface AccountConfig {
  name: string;
  companyId: CompanyTypes;
  credentials: Record<string, string>;
  enabled: boolean;
}

export interface Config {
  accounts: AccountConfig[];
  outputDir: string;
  startDate: Date;
  showBrowser: boolean;
  warnings: string[];
}

export interface LoadConfigOptions {
  showBrowser?: boolean;
  daysBack?: number;
}

const DEFAULT_DAYS_BACK = 60;
const DEFAULT_OUTPUT_DIR = "./output";

function getEnv(key: string): string {
  return process.env[key] ?? "";
}

/**
 * Validate and parse daysBack option
 */
export function validateDaysBack(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_DAYS_BACK;
  }

  const num = typeof value === "string" ? parseInt(value, 10) : Number(value);

  if (isNaN(num) || num < 1) {
    throw new Error(`Invalid daysBack value: ${String(value)}. Must be a positive number.`);
  }

  return num;
}

/**
 * Calculate start date from daysBack
 */
export function calculateStartDate(daysBack: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  // Set to start of day to ensure consistent behavior
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(options: LoadConfigOptions = {}): Config {
  const daysBack = validateDaysBack(options.daysBack);
  const startDate = calculateStartDate(daysBack);
  const accounts: AccountConfig[] = BANK_DEFINITIONS.map((bank) => {
    const credentials = Object.fromEntries(
      Object.entries(bank.credentialFields).map(([field, envVar]) => [field, getEnv(envVar)])
    ) as Record<string, string>;
    return {
      name: bank.name,
      companyId: bank.companyId,
      credentials,
      enabled: Object.values(credentials).every(Boolean),
    };
  });
  const warnings: string[] = [];

  if (daysBack > 365) {
    warnings.push(`Warning: daysBack=${daysBack} is very large. Most banks only return 90 days of data.`);
  }

  const enabledCount = accounts.filter((a) => a.enabled).length;
  if (enabledCount === 0) {
    warnings.push(
      `Warning: No accounts have credentials configured. Add credentials in the GUI Accounts tab or set them in ${getEnvFilePath()}.`
    );
  }

  return {
    accounts,
    outputDir: getEnv("OUTPUT_DIR") || DEFAULT_OUTPUT_DIR,
    startDate,
    showBrowser: options.showBrowser ?? false,
    warnings,
  };
}




