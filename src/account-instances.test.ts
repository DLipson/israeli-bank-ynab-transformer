import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BANK_DEFINITIONS } from "./banks.js";
import {
  bankEnvPrefix,
  credentialEnvVar,
  instanceFieldKey,
  instanceSlug,
  listInstances,
  saveExtraInstances,
  validateAccountName,
} from "./account-instances.js";

const OVERRIDE_ENV = "ISRAELI_BANK_YNAB_CONFIG_DIR";
const createdDirs: string[] = [];

function useTempConfigDir(): void {
  const dir = mkdtempSync(join(tmpdir(), "ibyt-instances-"));
  createdDirs.push(dir);
  process.env[OVERRIDE_ENV] = dir;
}

afterEach(() => {
  delete process.env[OVERRIDE_ENV];
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("credential env var derivation", () => {
  it("matches the legacy env var names for every bank field", () => {
    // Guards the catalog refactor: these names must never change or saved creds vanish.
    const legacy: Record<string, Record<string, string>> = {
      Leumi: { username: "LEUMI_USERNAME", password: "LEUMI_PASSWORD" },
      Hapoalim: { userCode: "HAPOALIM_USERCODE", password: "HAPOALIM_PASSWORD" },
      Discount: { id: "DISCOUNT_ID", password: "DISCOUNT_PASSWORD", num: "DISCOUNT_NUM" },
      Mizrahi: { username: "MIZRAHI_USERNAME", password: "MIZRAHI_PASSWORD" },
      Max: { username: "MAX_USERNAME", password: "MAX_PASSWORD" },
      "Visa Cal": { username: "VISACAL_USERNAME", password: "VISACAL_PASSWORD" },
      Isracard: {
        id: "ISRACARD_ID",
        card6Digits: "ISRACARD_CARD6DIGITS",
        password: "ISRACARD_PASSWORD",
      },
      Amex: { id: "AMEX_ID", card6Digits: "AMEX_CARD6DIGITS", password: "AMEX_PASSWORD" },
      "Otsar Hahayal": {
        username: "OTSARHAHAYAL_USERNAME",
        password: "OTSARHAHAYAL_PASSWORD",
      },
      Mercantile: { id: "MERCANTILE_ID", password: "MERCANTILE_PASSWORD", num: "MERCANTILE_NUM" },
    };

    for (const bank of BANK_DEFINITIONS) {
      for (const field of bank.fields) {
        expect(credentialEnvVar(bank.name, field)).toBe(legacy[bank.name][field]);
      }
    }
  });

  it("keeps the primary on legacy keys and scopes extras", () => {
    const primary = { accountName: "Leumi", bankName: "Leumi" };
    const extra = { accountName: "Leumi Dovid", bankName: "Leumi" };

    expect(instanceFieldKey(primary, "username")).toBe("LEUMI_USERNAME");
    expect(instanceFieldKey(extra, "username")).toBe("LEUMI_USERNAME__LEUMI_DOVID");
    expect(bankEnvPrefix("Otsar Hahayal")).toBe("OTSARHAHAYAL");
    expect(instanceSlug("Leumi Dovid")).toBe("LEUMI_DOVID");
  });
});

describe("listInstances", () => {
  it("returns one primary per bank with no extras", () => {
    useTempConfigDir();
    const instances = listInstances();
    expect(instances).toHaveLength(BANK_DEFINITIONS.length);
    expect(instances[0]).toEqual({ accountName: "Leumi", bankName: "Leumi" });
  });

  it("appends extras next to their bank", () => {
    useTempConfigDir();
    saveExtraInstances([{ accountName: "Leumi Dovid", bankName: "Leumi" }]);
    const instances = listInstances();
    expect(instances.slice(0, 2)).toEqual([
      { accountName: "Leumi", bankName: "Leumi" },
      { accountName: "Leumi Dovid", bankName: "Leumi" },
    ]);
  });
});

describe("validateAccountName", () => {
  it("rejects a name that collides with a primary bank", () => {
    useTempConfigDir();
    expect(validateAccountName("Leumi", "Leumi")).toMatch(/already exists/);
  });

  it("rejects an empty name and bad characters", () => {
    useTempConfigDir();
    expect(validateAccountName("  ", "Leumi")).toMatch(/required/);
    expect(validateAccountName("Leumi, Dovid", "Leumi")).toMatch(/letters/);
  });

  it("accepts a unique name", () => {
    useTempConfigDir();
    expect(validateAccountName("Leumi Dana", "Leumi")).toBeNull();
  });
});
