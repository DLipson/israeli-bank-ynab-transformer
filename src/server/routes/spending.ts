import { Router, type Request, type Response } from "express";
import { loadAppEnv } from "../../env.js";
import { getYnabToken } from "../../ynab/import-service.js";
import {
  createScheduled,
  getSpending,
  ignoreSuggestion,
  loadSettings,
  saveSettings,
} from "../../engine/safe-spending-service.js";
import type { CreditLimitGroup, Settings } from "../../engine/safe-spending.js";

const router = Router();

function handle(fn: (req: Request) => Promise<unknown> | unknown) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await fn(req));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  };
}

const isMoney = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function checkGroup(g: unknown): CreditLimitGroup {
  const group = g as Partial<CreditLimitGroup>;
  if (typeof group?.name !== "string" || !group.name.trim()) throw new Error("Each credit limit needs a name.");
  if (!isMoney(group.limit)) throw new Error(`Credit limit "${group.name}" needs an amount of 0 or more.`);
  if (!isStringList(group.accountIds) || group.accountIds.length === 0) {
    throw new Error(`Credit limit "${group.name}" needs at least one card.`);
  }
  return { name: group.name.trim(), limit: group.limit, accountIds: group.accountIds };
}

/** Only known fields with valid values are saved; ignored suggestions change through POST /ignore. */
function checkSettings(body: unknown, current: Settings): Settings {
  const b = body as Partial<Settings>;
  const next = { ...current };
  if (b.mode !== undefined) {
    if (b.mode !== "cashflow" && b.mode !== "ynab") throw new Error("mode must be cashflow or ynab.");
    next.mode = b.mode;
  }
  if (b.periodEnd !== undefined) {
    const ok = b.periodEnd === "month-end" || (Number.isInteger(b.periodEnd) && b.periodEnd >= 1 && b.periodEnd <= 31);
    if (!ok) throw new Error('periodEnd must be "month-end" or a day from 1 to 31.');
    next.periodEnd = b.periodEnd;
  }
  if (b.buffer !== undefined) {
    if (!isMoney(b.buffer)) throw new Error("buffer must be 0 or more.");
    next.buffer = b.buffer;
  }
  if (b.flexibleCategoryIds !== undefined) {
    if (!isStringList(b.flexibleCategoryIds)) throw new Error("flexibleCategoryIds must be a list.");
    next.flexibleCategoryIds = b.flexibleCategoryIds;
  }
  if (b.creditLimits !== undefined) {
    if (!Array.isArray(b.creditLimits)) throw new Error("creditLimits must be a list.");
    next.creditLimits = b.creditLimits.map(checkGroup);
    const ids = next.creditLimits.flatMap((g) => g.accountIds);
    if (new Set(ids).size !== ids.length) throw new Error("A card can be in only one credit limit group.");
  }
  if (b.overdraft !== undefined) {
    const o = b.overdraft;
    if (o !== null && (typeof o?.limitAccountId !== "string" || typeof o?.accountId !== "string")) {
      throw new Error("overdraft must be null or { limitAccountId, accountId }.");
    }
    next.overdraft = o;
  }
  return next;
}

router.get(
  "/",
  handle(async () => {
    loadAppEnv({ override: true });
    return getSpending(getYnabToken());
  })
);

router.put(
  "/settings",
  handle((req) => {
    const next = checkSettings(req.body, loadSettings());
    saveSettings(next);
    return next;
  })
);

/** Creates a monthly scheduled transaction in YNAB from a suggestion the user accepted. */
router.post(
  "/scheduled",
  handle(async (req) => {
    const b = req.body as { accountId?: unknown; date?: unknown; amount?: unknown; payeeName?: unknown; categoryId?: unknown };
    if (typeof b.accountId !== "string" || !b.accountId) throw new Error("accountId is required.");
    if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw new Error("date must be yyyy-mm-dd.");
    if (b.date <= new Date().toISOString().slice(0, 10)) throw new Error("date must be in the future.");
    if (!isMoney(b.amount) || b.amount === 0) throw new Error("amount must be more than 0.");
    if (typeof b.payeeName !== "string" || !b.payeeName.trim()) throw new Error("payeeName is required.");
    if (b.categoryId !== null && typeof b.categoryId !== "string") throw new Error("categoryId must be a string or null.");
    loadAppEnv({ override: true });
    await createScheduled(getYnabToken(), {
      accountId: b.accountId,
      date: b.date,
      amount: b.amount,
      payeeName: b.payeeName.trim(),
      categoryId: b.categoryId,
    });
    return { ok: true };
  })
);

router.post(
  "/ignore",
  handle((req) => {
    const { id } = req.body as { id?: unknown };
    if (typeof id !== "string" || !id) throw new Error("id is required.");
    return ignoreSuggestion(id);
  })
);

export default router;
