import type { Anomaly, CategorizeItem, ScheduleSuggestion } from "@/api/client";

export type InboxItem =
  | { kind: "unusual"; id: string; anomaly: Anomaly }
  | { kind: "categorize"; id: string; item: CategorizeItem }
  | { kind: "schedule"; id: string; suggestion: ScheduleSuggestion };

/** One queue: unusual, then categorize (with a suggestion first), then repeating payments with no schedule. */
export function buildQueue(anomalies: Anomaly[], categorize: CategorizeItem[], suggestions: ScheduleSuggestion[]): InboxItem[] {
  const byEvidence = [...categorize].sort((a, b) => Number(b.suggestions.length > 0) - Number(a.suggestions.length > 0));
  return [
    ...anomalies.map((anomaly) => ({ kind: "unusual" as const, id: anomaly.id, anomaly })),
    ...byEvidence.map((item) => ({ kind: "categorize" as const, id: item.id, item })),
    ...suggestions.map((suggestion) => ({ kind: "schedule" as const, id: suggestion.id, suggestion })),
  ];
}

export const ANOMALY_LABEL: Record<Anomaly["kind"], string> = {
  "unusual-charge": "Unusual charge",
  "new-payee": "New payee",
  duplicate: "Possible duplicate",
  "category-spike": "Category over normal",
  "price-increase": "Price went up",
};
