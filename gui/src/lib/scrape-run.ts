import { createContext, useContext } from "react";
import type { ScrapePayload, YnabImportResult, YnabRow } from "@/api/client";
import type { LogEntry } from "@/components/ScrapeLogs";

export type Phase = "settings" | "progress" | "results";

export interface AccountStatus {
  name: string;
  status: "pending" | "scraping" | "done" | "failed";
  transactionCount?: number;
  error?: string;
}
export type ExportResult = { csvPaths: string[]; auditLogPath: string };
export type CopyStatus = "idle" | "copied" | "failed";

export interface ScrapeRunParams {
  daysBack: number;
  showBrowser: boolean;
  enableDetailedLogging: boolean;
  detailedLoggingLimit: number;
  concurrency: number;
  selectedAccounts: string[];
  autoYnabImport: boolean;
}

export interface ScrapeRunState {
  phase: Phase;
  accountStatuses: AccountStatus[];
  entries: LogEntry[];
  payload: ScrapePayload | null;
  lastScrapeAt: string | null;
  error: string;
  ynabResult: YnabImportResult | null;
  ynabImporting: boolean;
  start: (params: ScrapeRunParams) => void;
  cancel: () => void;
  reset: () => void;
  setError: (message: string) => void;
  importRows: (rows?: YnabRow[], runId?: string) => Promise<void>;
}

/** The live scrape run, kept above the tabs so switching views does not stop it. */
export const ScrapeRunContext = createContext<ScrapeRunState | null>(null);

export function useScrapeRun(): ScrapeRunState {
  const state = useContext(ScrapeRunContext);
  if (!state) throw new Error("useScrapeRun needs a ScrapeRunProvider.");
  return state;
}

export const STORAGE_KEYS = {
  settings: "scrape.settings.v1",
  payload: "scrape.payload.v1",
  exportResult: "scrape.exportResult.v1",
  lastScrapeAt: "scrape.lastRun.v1",
} as const;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredJson<T>(key: string, value: T): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function removeStored(key: string): void {
  window.localStorage.removeItem(key);
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function extractLastScrapeAt(payload: ScrapePayload | null): string | null {
  if (!payload) return null;
  const auditLog = payload.auditLog as { timestamp?: string } | undefined;
  if (!auditLog?.timestamp) return null;
  return auditLog.timestamp;
}
