import { CompanyTypes } from "israeli-bank-scrapers";

/**
 * Bank definition with credential field mappings.
 * To add a new bank:
 * 1. Add entry here with companyId and credential fields
 * 2. Add corresponding env vars to .env.example
 */
export interface BankDefinition {
  name: string;
  companyId: CompanyTypes;
  /** Maps credential field name to environment variable name */
  credentialFields: Record<string, string>;
}

/**
 * All supported banks and their credential mappings.
 * Add new banks here - no other code changes needed.
 */
export const BANK_DEFINITIONS: BankDefinition[] = [
  {
    name: "Leumi",
    companyId: CompanyTypes.leumi,
    credentialFields: {
      username: "LEUMI_USERNAME",
      password: "LEUMI_PASSWORD",
    },
  },
  {
    name: "Hapoalim",
    companyId: CompanyTypes.hapoalim,
    credentialFields: {
      userCode: "HAPOALIM_USERCODE",
      password: "HAPOALIM_PASSWORD",
    },
  },
  {
    name: "Discount",
    companyId: CompanyTypes.discount,
    credentialFields: {
      id: "DISCOUNT_ID",
      password: "DISCOUNT_PASSWORD",
      num: "DISCOUNT_NUM",
    },
  },
  {
    name: "Mizrahi",
    companyId: CompanyTypes.mizrahi,
    credentialFields: {
      username: "MIZRAHI_USERNAME",
      password: "MIZRAHI_PASSWORD",
    },
  },
  {
    name: "Max",
    companyId: CompanyTypes.max,
    credentialFields: {
      username: "MAX_USERNAME",
      password: "MAX_PASSWORD",
    },
  },
  {
    name: "Visa Cal",
    companyId: CompanyTypes.visaCal,
    credentialFields: {
      username: "VISACAL_USERNAME",
      password: "VISACAL_PASSWORD",
    },
  },
  {
    name: "Isracard",
    companyId: CompanyTypes.isracard,
    credentialFields: {
      id: "ISRACARD_ID",
      card6Digits: "ISRACARD_CARD6DIGITS",
      password: "ISRACARD_PASSWORD",
    },
  },
  {
    name: "Amex",
    companyId: CompanyTypes.amex,
    credentialFields: {
      id: "AMEX_ID",
      card6Digits: "AMEX_CARD6DIGITS",
      password: "AMEX_PASSWORD",
    },
  },
  {
    name: "Otsar Hahayal",
    companyId: CompanyTypes.otsarHahayal,
    credentialFields: {
      username: "OTSARHAHAYAL_USERNAME",
      password: "OTSARHAHAYAL_PASSWORD",
    },
  },
  {
    name: "Mercantile",
    companyId: CompanyTypes.mercantile,
    credentialFields: {
      id: "MERCANTILE_ID",
      password: "MERCANTILE_PASSWORD",
      num: "MERCANTILE_NUM",
    },
  },
];
