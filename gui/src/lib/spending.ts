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

/** The spending numbers, loaded once by SpendingProvider and shared by Home, Review, Reports, and Setup. */
export interface SpendingState {
  data: SpendingData | null;
  loading: boolean;
  error: string;
  reload: () => void;
  setMode: (mode: SpendingSettings["mode"]) => void;
  removeSuggestion: (id: string) => void;
}

export const SpendingContext = createContext<SpendingState | null>(null);

export function useSpending(): SpendingState {
  const state = useContext(SpendingContext);
  if (!state) throw new Error("useSpending needs a SpendingProvider.");
  return state;
}
