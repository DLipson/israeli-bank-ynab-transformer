import { Router } from "express";
import {
  findBank,
  findInstance,
  instanceCredentialKeys,
  instanceFieldKey,
  isPrimaryInstance,
  listInstances,
  loadExtraInstances,
  saveExtraInstances,
  validateAccountName,
} from "../../account-instances.js";
import { readEnvFile, writeEnvFile, clearEnvVars } from "../env-io.js";
import { ensureAppConfigDirExists, getEnvFilePath, loadAppEnv } from "../../env.js";
import {
  deleteBankCredentialsFromWindowsCredentialManager,
  isWindowsCredentialManagerAvailable,
  saveBankCredentialsToWindowsCredentialManager,
} from "../../windows-credential-manager.js";

const router = Router();

function getCredentialSourceEnvVars(): Record<string, string> {
  if (!isWindowsCredentialManagerAvailable()) {
    return readEnvFile(getEnvFilePath());
  }

  const vars: Record<string, string> = {};
  for (const instance of listInstances()) {
    const bank = findBank(instance.bankName);
    if (!bank) {
      continue;
    }
    for (const envVar of instanceCredentialKeys(instance, bank)) {
      vars[envVar] = process.env[envVar] ?? "";
    }
  }
  return vars;
}

/**
 * GET /api/accounts
 * Returns every configured login (one primary per bank plus any extra instances),
 * with field names and enabled status. Never sends credential values.
 */
router.get("/", (_req, res) => {
  // Refresh from credential storage so UI reflects external changes without a server restart.
  loadAppEnv({ override: true });
  const envVars = getCredentialSourceEnvVars();

  const accounts = listInstances()
    .map((instance) => {
      const bank = findBank(instance.bankName);
      if (!bank) {
        return null;
      }
      const envKeys = instanceCredentialKeys(instance, bank);
      const enabled = envKeys.every((envKey) => (envVars[envKey] ?? "").length > 0);

      return {
        name: instance.accountName,
        bankName: instance.bankName,
        companyId: bank.companyId,
        fields: bank.fields,
        enabled,
        primary: isPrimaryInstance(instance),
      };
    })
    .filter((account): account is NonNullable<typeof account> => account !== null);

  res.json({ accounts });
});

/**
 * POST /api/accounts
 * Adds an extra login for an institution.
 */
router.post("/", (req, res) => {
  const { bankName, accountName } = req.body as { bankName?: string; accountName?: string };

  if (!bankName || !findBank(bankName)) {
    res.status(404).json({ error: `Bank "${bankName ?? ""}" not found` });
    return;
  }

  const trimmed = (accountName ?? "").trim();
  const error = validateAccountName(trimmed, bankName);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  try {
    const extras = loadExtraInstances();
    extras.push({ accountName: trimmed, bankName });
    saveExtraInstances(extras);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
    return;
  }

  res.json({ success: true, account: { name: trimmed, bankName } });
});

/**
 * PUT /api/accounts/:name/credentials
 * Saves credentials for one login (primary uses the bank's env vars, extras use scoped keys).
 */
router.put("/:name/credentials", (req, res) => {
  const { name } = req.params;
  const { credentials } = req.body as { credentials: Record<string, string> };

  const instance = findInstance(name);
  const bank = instance ? findBank(instance.bankName) : undefined;
  if (!instance || !bank) {
    res.status(404).json({ error: `Account "${name}" not found` });
    return;
  }

  if (!credentials || typeof credentials !== "object") {
    res.status(400).json({ error: "Missing credentials object" });
    return;
  }

  // Refresh from credential storage so empty fields can keep their existing value.
  loadAppEnv({ override: true });
  const existingEnvVars = getCredentialSourceEnvVars();

  // Map credential field names to storage keys. Empty fields keep the saved value.
  const updates: Record<string, string> = {};
  for (const field of bank.fields) {
    const envVar = instanceFieldKey(instance, field);
    const value = credentials[field];
    const hasExistingValue = (existingEnvVars[envVar] ?? "").length > 0;

    if (value === undefined || value === "") {
      if (hasExistingValue) {
        continue;
      }
      res.status(400).json({ error: `Missing required field: ${field}` });
      return;
    }
    updates[envVar] = value;
  }

  try {
    if (isWindowsCredentialManagerAvailable()) {
      saveBankCredentialsToWindowsCredentialManager(updates);
      ensureAppConfigDirExists();
      clearEnvVars(getEnvFilePath(), Object.keys(updates));
    } else {
      ensureAppConfigDirExists();
      writeEnvFile(getEnvFilePath(), updates);
    }

    loadAppEnv({ override: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
    return;
  }

  res.json({ success: true });
});

/**
 * DELETE /api/accounts/:name/credentials
 * Clears a primary login's credentials (keeping the row) or removes an extra login entirely.
 */
router.delete("/:name/credentials", (req, res) => {
  const { name } = req.params;

  const instance = findInstance(name);
  const bank = instance ? findBank(instance.bankName) : undefined;
  if (!instance || !bank) {
    res.status(404).json({ error: `Account "${name}" not found` });
    return;
  }

  const envKeys = instanceCredentialKeys(instance, bank);

  try {
    if (isWindowsCredentialManagerAvailable()) {
      deleteBankCredentialsFromWindowsCredentialManager(envKeys);
    }

    ensureAppConfigDirExists();
    clearEnvVars(getEnvFilePath(), envKeys);

    // Clear from in-memory env before reload.
    for (const key of envKeys) {
      delete process.env[key];
    }

    if (!isPrimaryInstance(instance)) {
      saveExtraInstances(loadExtraInstances().filter((extra) => extra.accountName !== name));
    }

    loadAppEnv({ override: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
    return;
  }

  res.json({ success: true });
});

export default router;
