import { Router, type Request, type Response } from "express";
import { loadAppEnv } from "../../env.js";
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
