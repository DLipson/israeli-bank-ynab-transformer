import { Router, type Request, type Response } from "express";
import { ensureAppConfigDirExists, getEnvFilePath, loadAppEnv } from "../../env.js";
import { clearEnvVars, writeEnvFile } from "../env-io.js";
import {
  isWindowsCredentialManagerAvailable,
  saveBankCredentialsToWindowsCredentialManager,
  YNAB_TOKEN_ENV_VAR,
} from "../../windows-credential-manager.js";
import type { YnabRow } from "../../transformer.js";
import {
  fetchYnabAccounts,
  fetchYnabBudgets,
  getYnabToken,
  importRowsToYnab,
  loadYnabImportConfig,
  saveYnabImportConfig,
  type YnabImportConfig,
} from "../../ynab/import-service.js";

const router = Router();

function handle(fn: (req: Request) => Promise<unknown> | unknown) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await fn(req));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  };
}

function token(): string {
  loadAppEnv({ override: true });
  return getYnabToken();
}

router.get(
  "/token",
  handle(() => {
    loadAppEnv({ override: true });
    return { saved: Boolean(process.env[YNAB_TOKEN_ENV_VAR]?.trim()) };
  })
);

router.put(
  "/token",
  handle((req) => {
    const { token: value } = req.body as { token?: unknown };
    if (typeof value !== "string" || !value.trim()) throw new Error("Token is required.");

    const updates = { [YNAB_TOKEN_ENV_VAR]: value.trim() };
    ensureAppConfigDirExists();
    if (isWindowsCredentialManagerAvailable()) {
      saveBankCredentialsToWindowsCredentialManager(updates);
      clearEnvVars(getEnvFilePath(), [YNAB_TOKEN_ENV_VAR]);
    } else {
      writeEnvFile(getEnvFilePath(), updates);
    }
    loadAppEnv({ override: true });
    return { saved: true };
  })
);

router.get("/budgets", handle(async () => ({ budgets: await fetchYnabBudgets(token()) })));

router.get(
  "/budgets/:budgetId/accounts",
  handle(async (req) => ({ accounts: await fetchYnabAccounts(token(), String(req.params.budgetId)) }))
);

router.get("/import-config", handle(() => loadYnabImportConfig()));

router.put(
  "/import-config",
  handle((req) => {
    const { budgetId, mappings } = req.body as Partial<YnabImportConfig>;
    if (typeof budgetId !== "string" || !mappings || typeof mappings !== "object") {
      throw new Error("Body must include budgetId and mappings.");
    }
    const config = { budgetId, mappings };
    saveYnabImportConfig(config);
    return config;
  })
);

router.post(
  "/import",
  handle(async (req) => {
    const { rows } = req.body as { rows?: YnabRow[] };
    if (!Array.isArray(rows)) throw new Error("Missing rows.");
    return importRowsToYnab(token(), loadYnabImportConfig(), rows);
  })
);

export default router;
