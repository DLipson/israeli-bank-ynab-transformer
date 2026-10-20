import { describe, expect, it } from "vitest";
import type { Anomaly, CategorizeItem, ScheduleSuggestion } from "@/api/client";
import { buildQueue } from "@/lib/inbox";

const anomaly = (id: string) => ({ id, kind: "new-payee", date: "2026-10-02", title: "New payee: X", detail: "", amount: 1, transactionIds: [] }) as Anomaly;
const item = (id: string, suggested: boolean) =>
  ({ id, suggestions: suggested ? [{ categoryId: "c", categoryName: "C", evidence: "history", note: "" }] : [] }) as unknown as CategorizeItem;
const schedule = (id: string) => ({ id }) as ScheduleSuggestion;

describe("buildQueue", () => {
  it("puts unusual first, then categorize (suggested before unsuggested), then schedules", () => {
    const queue = buildQueue([anomaly("a")], [item("t1", false), item("t2", true)], [schedule("s")]);
    expect(queue.map((q) => `${q.kind}:${q.id}`)).toEqual(["unusual:a", "categorize:t2", "categorize:t1", "schedule:s"]);
  });
});
