import { CompanyTypes } from "israeli-bank-scrapers";

/**
 * Bank definition (catalog entry).
 * To add a new bank:
 * 1. Add an entry here with companyId and credential field names
 * 2. Add corresponding env vars to .env.example
 *
 * Credential storage keys are derived from `name` + field (see account-instances.ts),
 * so this catalog stays free of storage details.
 */
export interface BankDefinition {
  name: string;
  companyId: CompanyTypes;
  /** Credential field names, in form order. */
  fields: string[];
}

/**
 * All supported banks. Add new banks here - no other code changes needed.
 */
export const BANK_DEFINITIONS: BankDefinition[] = [
  {
    name: "Leumi",
    companyId: CompanyTypes.leumi,
    fields: ["username", "password"],
  },
  {
    name: "Hapoalim",
    companyId: CompanyTypes.hapoalim,
    fields: ["userCode", "password"],
  },
  {
    name: "Discount",
    companyId: CompanyTypes.discount,
    fields: ["id", "password", "num"],
  },
  {
    name: "Mizrahi",
    companyId: CompanyTypes.mizrahi,
    fields: ["username", "password"],
  },
  {
    name: "Max",
    companyId: CompanyTypes.max,
    fields: ["username", "password"],
  },
  {
    name: "Visa Cal",
    companyId: CompanyTypes.visaCal,
    fields: ["username", "password"],
  },
  {
    name: "Isracard",
    companyId: CompanyTypes.isracard,
    fields: ["id", "card6Digits", "password"],
  },
  {
    name: "Amex",
    companyId: CompanyTypes.amex,
    fields: ["id", "card6Digits", "password"],
  },
  {
    name: "Otsar Hahayal",
    companyId: CompanyTypes.otsarHahayal,
    fields: ["username", "password"],
  },
  {
    name: "Mercantile",
    companyId: CompanyTypes.mercantile,
    fields: ["id", "password", "num"],
  },
];
