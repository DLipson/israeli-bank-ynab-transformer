import { Router, type Request, type Response } from "express";
import { ensureAppConfigDirExists, getEnvFilePath, loadAppEnv } from "../../env.js";
import { clearEnvVars, writeEnvFile } from "../env-io.js";
import {
  isWindowsCredentialManagerAvailable,
  saveBankCredentialsToWindowsCredentialManager,
  SERPER_KEY_ENV_VAR,
} from "../../windows-credential-manager.js";
import { getYnabToken } from "../../ynab/import-service.js";
import {
  getCategorizeList,
  getLlmSuggestions,
  saveRejection,
  setCategory,
} from "../../ynab/categorize-service.js";

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

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

router.get(
  "/",
  handle(async (req) => {
    const days = Math.min(Math.max(Number(req.query.days) || 31, 1), 365);
    // sync=0: only the days changed, so reuse the last YNAB sync.
    const sync = req.query.sync !== "0";
    return {
      ...(await getCategorizeList(token(), days, sync)),
      searchKeySaved: Boolean(process.env[SERPER_KEY_ENV_VAR]?.trim()),
    };
  })
);

router.post(
  "/llm",
  handle(async (req) => {
    const { ids } = req.body as { ids?: unknown };
    if (!Array.isArray(ids)) throw new Error("ids must be a list.");
    loadAppEnv({ override: true });
    return { suggestions: await getLlmSuggestions(ids.map(String)) };
  })
);

router.post(
  "/accept",
  handle(async (req) => {
    const { id, categoryId } = req.body as { id?: unknown; categoryId?: unknown };
    await setCategory(token(), requireString(id, "id"), requireString(categoryId, "categoryId"));
    return { ok: true };
  })
);

router.post(
  "/reject",
  handle((req) => {
    const { id, categoryId } = req.body as { id?: unknown; categoryId?: unknown };
    saveRejection(requireString(id, "id"), requireString(categoryId, "categoryId"));
    return { ok: true };
  })
);

router.put(
  "/search-key",
  handle((req) => {
    const updates = { [SERPER_KEY_ENV_VAR]: requireString((req.body as { key?: unknown }).key, "key") };
    ensureAppConfigDirExists();
    if (isWindowsCredentialManagerAvailable()) {
      saveBankCredentialsToWindowsCredentialManager(updates);
      clearEnvVars(getEnvFilePath(), [SERPER_KEY_ENV_VAR]);
    } else {
      writeEnvFile(getEnvFilePath(), updates);
    }
    loadAppEnv({ override: true });
    return { saved: true };
  })
);

export default router;
