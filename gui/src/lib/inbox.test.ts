import { describe, expect, it } from "vitest";
import type { Anomaly, CategorizeItem, ScheduleSuggestion } from "@/api/client";
import { buildQueue } from "@/lib/inbox";

const anomaly = (id: string) => ({ id, kind: "new-payee", date: "2026-10-02", title: "New payee: X", detail: "", amount: 1, transactionIds: [] }) as Anomaly;
const item = (id: string, suggested: boolean) =>
  ({ id, suggestions: suggested ? [{ categoryId: "c", categoryName: "C", evidence: "history", note: "" }] : [] }) as unknown as CategorizeItem;
const schedule = (id: string) => ({ id }) as ScheduleSuggestion;

describe("buildQueue", () => {
  it("puts unusual first, then missing rows, then categorize (suggested before unsuggested), then schedules", () => {
    const missing = { id: "m", side: "not-in-ynab", accountName: "Card", date: "2026-10-13", amount: -30000, payee: "X" } as const;
    const queue = buildQueue([anomaly("a")], [missing], [item("t1", false), item("t2", true)], [schedule("s")]);
    expect(queue.map((q) => `${q.kind}:${q.id}`)).toEqual(["unusual:a", "missing:m", "categorize:t2", "categorize:t1", "schedule:s"]);
  });
});
