import { Router } from "express";
import { BANK_DEFINITIONS } from "../../banks.js";
import { readEnvFile, writeEnvFile, clearEnvVars } from "../env-io.js";
import { ensureAppConfigDirExists, getEnvFilePath, loadAppEnv } from "../../env.js";
import {
  deleteBankCredentialsFromWindowsCredentialManager,
  isWindowsCredentialManagerAvailable,
  saveBankCredentialsToWindowsCredentialManager,
} from "../../windows-credential-manager.js";

const router = Router();

function getEnvPath(): string {
  return getEnvFilePath();
}

function reloadEnv(): void {
  loadAppEnv();
}

function getCredentialSourceEnvVars(): Record<string, string> {
  if (!isWindowsCredentialManagerAvailable()) {
    return readEnvFile(getEnvPath());
  }

  const vars: Record<string, string> = {};
  for (const bank of BANK_DEFINITIONS) {
    for (const envVar of Object.values(bank.credentialFields)) {
      vars[envVar] = process.env[envVar] ?? "";
    }
  }
  return vars;
}

/**
 * GET /api/accounts
 * Returns all banks with their field names and enabled status.
 * Never sends credential values.
 */
router.get("/", (_req, res) => {
  // Refresh from credential storage so UI reflects external changes without a server restart.
  reloadEnv();
  const envVars = getCredentialSourceEnvVars();

  const accounts = BANK_DEFINITIONS.map((bank) => {
    const fields = Object.keys(bank.credentialFields);
    const envKeys = Object.values(bank.credentialFields);
    const allFilled = envKeys.every((envKey) => (envVars[envKey] ?? "").length > 0);

    return {
      name: bank.name,
      companyId: bank.companyId,
      fields,
      enabled: allFilled,
    };
  });

  res.json({ accounts });
});

/**
 * PUT /api/accounts/:name/credentials
 * Saves credentials for a bank to the app env file in ~/.config.
 */
router.put("/:name/credentials", (req, res) => {
  const { name } = req.params;
  const { credentials } = req.body as { credentials: Record<string, string> };

  const bank = BANK_DEFINITIONS.find((b) => b.name === name);
  if (!bank) {
    res.status(404).json({ error: `Bank "${name}" not found` });
    return;
  }

  if (!credentials || typeof credentials !== "object") {
    res.status(400).json({ error: "Missing credentials object" });
    return;
  }

  // Map credential field names to env var names
  const updates: Record<string, string> = {};
  for (const [field, envVar] of Object.entries(bank.credentialFields)) {
    const value = credentials[field];
    if (value === undefined || value === "") {
      res.status(400).json({ error: `Missing required field: ${field}` });
      return;
    }
    updates[envVar] = value;
  }

  try {
    if (isWindowsCredentialManagerAvailable()) {
      saveBankCredentialsToWindowsCredentialManager(updates);
      ensureAppConfigDirExists();
      clearEnvVars(getEnvPath(), Object.keys(updates));
    } else {
      ensureAppConfigDirExists();
      writeEnvFile(getEnvPath(), updates);
    }

    reloadEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
    return;
  }

  res.json({ success: true });
});

/**
 * DELETE /api/accounts/:name/credentials
 * Clears credentials for a bank from the app env file in ~/.config.
 */
router.delete("/:name/credentials", (req, res) => {
  const { name } = req.params;

  const bank = BANK_DEFINITIONS.find((b) => b.name === name);
  if (!bank) {
    res.status(404).json({ error: `Bank "${name}" not found` });
    return;
  }

  const envKeys = Object.values(bank.credentialFields);

  try {
    if (isWindowsCredentialManagerAvailable()) {
      deleteBankCredentialsFromWindowsCredentialManager(envKeys);
    }

    ensureAppConfigDirExists();
    clearEnvVars(getEnvPath(), envKeys);

    // Clear from in-memory env before reload.
    for (const key of envKeys) {
      delete process.env[key];
    }

    reloadEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
    return;
  }

  res.json({ success: true });
});

export default router;
