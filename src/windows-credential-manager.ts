import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BANK_DEFINITIONS } from "./banks.js";

const SERVICE_NAME = "israeli-bank-ynab-transformer";
const SCRIPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "windows-credential-manager.ps1"
);
const POWERSHELL_COMMANDS = ["pwsh", "powershell"];

type ScriptAction = "Get" | "Set" | "Delete" | "GetMany" | "SetMany" | "DeleteMany";

export function isWindowsCredentialManagerAvailable(): boolean {
  return process.platform === "win32" && existsSync(SCRIPT_PATH);
}

export function getBankCredentialEnvVars(): string[] {
  const keys = new Set<string>();
  for (const bank of BANK_DEFINITIONS) {
    for (const envVar of Object.values(bank.credentialFields)) {
      keys.add(envVar);
    }
  }
  return [...keys];
}

export function hydrateEnvWithStoredBankCredentials(): void {
  if (!isWindowsCredentialManagerAvailable()) {
    return;
  }

  try {
    const envVars = getBankCredentialEnvVars();
    const targets = envVars.map((envVar) => toTarget(envVar));
    const raw = runCredentialScript("GetMany", { itemsJson: JSON.stringify(targets) }).trim();
    const byTarget = raw ? (JSON.parse(raw) as Record<string, string>) : {};

    for (const envVar of envVars) {
      if (process.env[envVar]?.trim()) {
        continue;
      }
      const value = (byTarget[toTarget(envVar)] ?? "").trim();
      if (value) {
        process.env[envVar] = value;
      }
    }
  } catch {
    // Fail-open so startup still works even if credential manager access fails.
  }
}

export function saveBankCredentialsToWindowsCredentialManager(updates: Record<string, string>): void {
  if (!isWindowsCredentialManagerAvailable()) {
    throw new Error("Windows Credential Manager is not available on this system.");
  }

  const items = Object.entries(updates).map(([envVar, value]) => ({
    target: toTarget(envVar),
    username: envVar,
    secret: value,
  }));

  if (items.length === 0) {
    return;
  }

  runCredentialScript("SetMany", { itemsJson: JSON.stringify(items) });
}

export function deleteBankCredentialsFromWindowsCredentialManager(envVars: string[]): void {
  if (!isWindowsCredentialManagerAvailable()) {
    throw new Error("Windows Credential Manager is not available on this system.");
  }

  if (envVars.length === 0) {
    return;
  }

  runCredentialScript(
    "DeleteMany",
    { itemsJson: JSON.stringify(envVars.map((envVar) => toTarget(envVar))) }
  );
}

function toTarget(envVar: string): string {
  return `${SERVICE_NAME}:${envVar}`;
}

function runCredentialScript(action: ScriptAction, params: Record<string, string>): string {
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    SCRIPT_PATH,
    "-Action",
    action,
  ];

  for (const [key, value] of Object.entries(params)) {
    args.push(`-${key}`, value);
  }

  let launchError: string | null = null;

  for (const command of POWERSHELL_COMMANDS) {
    const result = spawnSync(command, args, { encoding: "utf-8" });
    if (result.error) {
      launchError = result.error.message;
      continue;
    }

    if (result.status !== 0) {
      const stderr = result.stderr?.trim();
      throw new Error(stderr || `Credential operation failed with exit code ${result.status ?? "unknown"}.`);
    }

    return result.stdout ?? "";
  }

  throw new Error(
    `Unable to execute PowerShell to access Windows Credential Manager${launchError ? `: ${launchError}` : "."}`
  );
}
