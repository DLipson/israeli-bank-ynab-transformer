import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { BANK_DEFINITIONS, type BankDefinition } from "./banks.js";
import { ensureAppConfigDirExists, getAccountsConfigPath } from "./paths.js";

/**
 * A configured login. `accountName` is the stable identity (used as the bank
 * transaction's `accountName`, its `memo.source` prefix, the YNAB mapping key,
 * CSV split key, and route param). `bankName` points at a BANK_DEFINITIONS entry.
 */
export interface AccountInstance {
  accountName: string;
  bankName: string;
}

const ACCOUNT_NAME_PATTERN = /^[A-Za-z0-9 _-]+$/;
const MAX_ACCOUNT_NAME = 48;

export function findBank(bankName: string): BankDefinition | undefined {
  return BANK_DEFINITIONS.find((bank) => bank.name === bankName);
}

/** The implicit instance for a bank: accountName === bankName. Never removable. */
export function isPrimaryInstance(instance: AccountInstance): boolean {
  return instance.accountName === instance.bankName;
}

export function instanceSlug(accountName: string): string {
  return accountName.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
}

/** Only user-added instances are persisted; primaries are implicit. */
export function loadExtraInstances(): AccountInstance[] {
  const path = getAccountsConfigPath();
  if (!existsSync(path)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is AccountInstance =>
        !!entry &&
        typeof (entry as AccountInstance).accountName === "string" &&
        typeof (entry as AccountInstance).bankName === "string"
    );
  } catch {
    return [];
  }
}

export function saveExtraInstances(instances: AccountInstance[]): void {
  const cleaned = instances
    .filter((entry) => findBank(entry.bankName) && entry.accountName.trim().length > 0)
    .map((entry) => ({ accountName: entry.accountName.trim(), bankName: entry.bankName }));

  ensureAppConfigDirExists();
  writeFileSync(getAccountsConfigPath(), JSON.stringify(cleaned, null, 2), "utf-8");
}

/** Primary instance per bank plus extras, grouped by bank in catalog order. */
export function listInstances(): AccountInstance[] {
  const extras = loadExtraInstances();
  const instances: AccountInstance[] = [];

  for (const bank of BANK_DEFINITIONS) {
    instances.push({ accountName: bank.name, bankName: bank.name });
    for (const extra of extras) {
      if (extra.bankName === bank.name) {
        instances.push(extra);
      }
    }
  }

  return instances;
}

export function findInstance(accountName: string): AccountInstance | undefined {
  return listInstances().find((instance) => instance.accountName === accountName);
}

/** Returns an error message, or null when the name is acceptable. */
export function validateAccountName(accountName: string, bankName: string): string | null {
  const name = accountName.trim();

  if (!name) {
    return "Account name is required.";
  }
  if (name.length > MAX_ACCOUNT_NAME) {
    return `Account name must be ${MAX_ACCOUNT_NAME} characters or fewer.`;
  }
  if (!ACCOUNT_NAME_PATTERN.test(name)) {
    return "Use only letters, numbers, spaces, hyphens, and underscores.";
  }

  const slug = instanceSlug(name);
  const clash = listInstances().some(
    (instance) =>
      instance.accountName.toLowerCase() === name.toLowerCase() ||
      (instance.bankName === bankName && instanceSlug(instance.accountName) === slug)
  );

  return clash ? `An account named "${name}" already exists.` : null;
}

// --- Credential storage keys (derived here, not in the bank catalog) ---

export function bankEnvPrefix(bankName: string): string {
  return bankName.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function credentialEnvVar(bankName: string, field: string): string {
  return `${bankEnvPrefix(bankName)}_${field.toUpperCase()}`;
}

export function instanceFieldKey(instance: AccountInstance, field: string): string {
  const base = credentialEnvVar(instance.bankName, field);
  if (isPrimaryInstance(instance)) {
    return base;
  }
  return `${base}__${instanceSlug(instance.accountName)}`;
}

export function instanceCredentialKeys(instance: AccountInstance, bank: BankDefinition): string[] {
  return bank.fields.map((field) => instanceFieldKey(instance, field));
}
