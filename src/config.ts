import { CompanyTypes } from "israeli-bank-scrapers";
import "dotenv/config";
import { BANK_DEFINITIONS, type BankDefinition } from "./banks.js";

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

function hasAllCredentials(creds: Record<string, string>): boolean {
  return Object.values(creds).every((v) => v.length > 0);
}

/**
 * Build credentials object from environment variables
 */
function buildCredentials(bank: BankDefinition): Record<string, string> {
  const credentials: Record<string, string> = {};
  for (const [field, envVar] of Object.entries(bank.credentialFields)) {
    credentials[field] = getEnv(envVar);
  }
  return credentials;
}

/**
 * Convert bank definitions to account configs
 */
function buildAccountConfigs(): AccountConfig[] {
  return BANK_DEFINITIONS.map((bank) => {
    const credentials = buildCredentials(bank);
    return {
      name: bank.name,
      companyId: bank.companyId,
      credentials,
      enabled: hasAllCredentials(credentials),
    };
  });
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
  const accounts = buildAccountConfigs();
  const warnings: string[] = [];

  if (daysBack > 365) {
    warnings.push(`Warning: daysBack=${daysBack} is very large. Most banks only return 90 days of data.`);
  }

  const enabledCount = accounts.filter((a) => a.enabled).length;
  if (enabledCount === 0) {
    warnings.push(
      "Warning: No accounts have credentials configured. Copy .env.example to .env and fill in your credentials."
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

/**
 * Get list of all supported bank names
 */
export function getSupportedBanks(): string[] {
  return BANK_DEFINITIONS.map((b) => b.name);
}
