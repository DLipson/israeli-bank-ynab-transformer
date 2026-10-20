import { createContext, useContext } from "react";
import type { SpendingData, SpendingSettings } from "@/api/client";

/** Amounts from the API are YNAB milliunits. */
export const K = 1000;

export function shekels(milliunits: number): string {
  const value = Math.round(milliunits / K);
  return `${value < 0 ? "−" : ""}₪${Math.abs(value).toLocaleString("en-US")}`;
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IL", { day: "numeric", month: "short" });
}

export function monthLabel(yyyyMm: string): string {
  return new Date(`${yyyyMm}-01T00:00:00`).toLocaleDateString("en-IL", { month: "short", year: "numeric" });
}

/** An edit of one everyday essential applies to this period only; an override for an old period is dropped. */
export function nextEssentialsOverride(
  current: SpendingSettings["essentialsOverride"],
  periodEnd: string,
  categoryId: string,
  amount: number
): NonNullable<SpendingSettings["essentialsOverride"]> {
  const kept = current?.period === periodEnd ? current.amounts : {};
  return { period: periodEnd, amounts: { ...kept, [categoryId]: amount } };
}

/** The spending numbers, loaded once by SpendingProvider and shared by Home, Review, Reports, and Setup. */
export interface SpendingState {
  data: SpendingData | null;
  loading: boolean;
  error: string;
  reload: () => void;
  removeSuggestion: (id: string) => void;
}

export const SpendingContext = createContext<SpendingState | null>(null);

export function useSpending(): SpendingState {
  const state = useContext(SpendingContext);
  if (!state) throw new Error("useSpending needs a SpendingProvider.");
  return state;
}
