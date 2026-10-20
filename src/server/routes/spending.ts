import { Router, type Request, type Response } from "express";
import { loadAppEnv } from "../../env.js";
import { getYnabToken } from "../../ynab/import-service.js";
import {
  createScheduled,
  deleteCreatedScheduled,
  dismissAnomaly,
  getSpending,
  ignoreSuggestion,
  loadSettings,
  recentPurchases,
  restoreAnomaly,
  restoreSuggestion,
  treatAsRefund,
  saveSettings,
  spendingCategoryIds,
} from "../../engine/safe-spending-service.js";
import { paydayFromPeriodEnd, type CreditLimitGroup, type Settings } from "../../engine/safe-spending.js";
import { generateReport, latestReports, REPORT_TYPES } from "../../engine/reports-service.js";
import type { ReportType } from "../../engine/reports.js";
import { getReconcile } from "../../engine/reconcile-service.js";

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

/**
 * Only known fields with valid values are saved; ignored suggestions change through POST /ignore,
 * and createdScheduleIds only through POST /scheduled. `categoryIds` reads YNAB only when the body
 * names categories.
 */
async function checkSettings(body: unknown, current: Settings, categoryIds: () => Promise<Set<string>>): Promise<Settings> {
  const b = body as Partial<Settings> & { periodEnd?: unknown };
  const next = { ...current };
  if (b.periodEnd !== undefined && b.payday === undefined) {
    const oldPeriodEnd = b.periodEnd;
    const ok = oldPeriodEnd === "month-end" || (Number.isInteger(oldPeriodEnd) && Number(oldPeriodEnd) >= 1 && Number(oldPeriodEnd) <= 31);
    if (!ok) throw new Error('periodEnd must be "month-end" or a day from 1 to 31.');
    next.payday = paydayFromPeriodEnd(oldPeriodEnd as "month-end" | number);
  }
  if (b.mode !== undefined) {
    if (b.mode !== "cashflow" && b.mode !== "ynab") throw new Error("mode must be cashflow or ynab.");
    next.mode = b.mode;
  }
  if (b.payday !== undefined) {
    const ok = b.payday === "month-start" || (Number.isInteger(b.payday) && b.payday >= 1 && b.payday <= 31);
    if (!ok) throw new Error('payday must be "month-start" or a day from 1 to 31.');
    next.payday = b.payday;
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
  if (b.cardWarningLevel !== undefined) {
    if (!isMoney(b.cardWarningLevel)) throw new Error("cardWarningLevel must be 0 or more.");
    next.cardWarningLevel = b.cardWarningLevel;
  }
  if (b.essentialCategoryIds !== undefined || b.essentialsOverride) {
    const known = await categoryIds();
    const unknown = (ids: string[]) => ids.find((id) => !known.has(id));
    if (b.essentialCategoryIds !== undefined) {
      if (!isStringList(b.essentialCategoryIds)) throw new Error("essentialCategoryIds must be a list.");
      const bad = unknown(b.essentialCategoryIds);
      if (bad) throw new Error(`Unknown category: ${bad}.`);
      next.essentialCategoryIds = [...new Set(b.essentialCategoryIds)];
    }
    if (b.essentialsOverride) {
      const o = b.essentialsOverride as Partial<NonNullable<Settings["essentialsOverride"]>>;
      if (typeof o.period !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.period)) {
        throw new Error("essentialsOverride needs a period (yyyy-mm-dd).");
      }
      if (typeof o.amounts !== "object" || o.amounts === null || Array.isArray(o.amounts)) {
        throw new Error("essentialsOverride needs amounts.");
      }
      const bad = unknown(Object.keys(o.amounts));
      if (bad) throw new Error(`Unknown category: ${bad}.`);
      if (!Object.values(o.amounts).every(isMoney)) throw new Error("Each essentials amount must be 0 or more.");
      next.essentialsOverride = { period: o.period, amounts: o.amounts };
    }
  }
  if (b.essentialsOverride === null) next.essentialsOverride = null;
  if (b.baselineMonths !== undefined) {
    if (!Number.isInteger(b.baselineMonths) || b.baselineMonths < 1 || b.baselineMonths > 24) {
      throw new Error("baselineMonths must be a whole number from 1 to 24.");
    }
    next.baselineMonths = b.baselineMonths;
  }
  return next;
}

router.get(
  "/",
  handle(async (req) => {
    loadAppEnv({ override: true });
    // quick=1: reload after a settings change; reuses the last YNAB read.
    return getSpending(getYnabToken(), undefined, { quick: req.query.quick === "1" });
  })
);

router.put(
  "/settings",
  handle(async (req) => {
    const next = await checkSettings(req.body, loadSettings(), () => {
      loadAppEnv({ override: true });
      return spendingCategoryIds(getYnabToken());
    });
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
    const id = await createScheduled(getYnabToken(), {
      accountId: b.accountId,
      date: b.date,
      amount: b.amount,
      payeeName: b.payeeName.trim(),
      categoryId: b.categoryId,
    });
    return { ok: true, id };
  })
);

/** Inbox Undo: deletes a schedule in YNAB that this app created (YNAB write, user's click only). */
router.delete(
  "/scheduled/:id",
  handle(async (req) => {
    loadAppEnv({ override: true });
    await deleteCreatedScheduled(getYnabToken(), String(req.params.id));
    return { ok: true };
  })
);

/** Purchases a refund can be linked to (read-only). `today` is for tests. */
router.get(
  "/purchases",
  handle(async (req) => {
    loadAppEnv({ override: true });
    return { purchases: await recentPurchases(getYnabToken(), typeof req.query.today === "string" ? req.query.today : undefined) };
  })
);

/** Treat as refund: YNAB write (the refund gets the purchase's category), only from the user's click. */
router.post(
  "/refund",
  handle(async (req) => {
    const { refundTxId, purchaseTxId } = req.body as { refundTxId?: unknown; purchaseTxId?: unknown };
    if (typeof refundTxId !== "string" || typeof purchaseTxId !== "string") throw new Error("refundTxId and purchaseTxId are required.");
    loadAppEnv({ override: true });
    await treatAsRefund(getYnabToken(), refundTxId, purchaseTxId);
    return { ok: true };
  })
);

router.post("/anomalies/:id/restore", handle((req) => restoreAnomaly(String(req.params.id))));

router.post("/suggestions/:id/restore", handle((req) => restoreSuggestion(String(req.params.id))));

router.post(
  "/ignore",
  handle((req) => {
    const { id } = req.body as { id?: unknown };
    if (typeof id !== "string" || !id) throw new Error("id is required.");
    return ignoreSuggestion(id);
  })
);

router.post(
  "/anomalies/dismiss",
  handle((req) => {
    const { id } = req.body as { id?: unknown };
    if (typeof id !== "string" || !id) throw new Error("id is required.");
    return dismissAnomaly(id);
  })
);

router.get("/reports", handle(() => latestReports()));

router.get(
  "/reconcile",
  handle(async () => {
    loadAppEnv({ override: true });
    return { accounts: await getReconcile(getYnabToken()) };
  })
);

/** Makes one report now and saves it (read-only towards YNAB). */
router.post(
  "/reports/:type",
  handle(async (req) => {
    const type = String(req.params.type) as ReportType;
    if (!REPORT_TYPES.includes(type)) throw new Error(`type must be one of: ${REPORT_TYPES.join(", ")}.`);
    loadAppEnv({ override: true });
    return generateReport(getYnabToken(), type);
  })
);

export default router;
