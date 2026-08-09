const BASE = "/api";

export interface AccountInfo {
  name: string;
  fields: string[];
  enabled: boolean;
}

export interface YnabRow {
  date: string;
  payee: string;
  memo: string;
  outflow: string;
  inflow: string;
}

export interface SkippedItem {
  txn: Record<string, unknown>;
  reason: string;
}

export interface AccountSummaryData {
  count: number;
  outflow: number;
  inflow: number;
}

export interface TransactionSummary {
  byAccount: Record<string, AccountSummaryData>;
  totalOutflow: number;
  totalInflow: number;
}

export interface ScrapePayload {
  skipped: SkippedItem[];
  rows: YnabRow[];
  summary: TransactionSummary;
  auditLog: Record<string, unknown>;
}

export interface SSEEvent {
  type: "warning" | "progress" | "account-done" | "done" | "error";
  message?: string;
  accountName?: string;
  success?: boolean;
  transactionCount?: number;
  error?: string;
  payload?: ScrapePayload;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

// --- Accounts ---

export async function getAccounts(): Promise<AccountInfo[]> {
  return (await request<{ accounts: AccountInfo[] }>("/accounts")).accounts;
}

export async function saveCredentials(name: string, credentials: Record<string, string>): Promise<void> {
  await request(`/accounts/${encodeURIComponent(name)}/credentials`, {
    method: "PUT",
    body: JSON.stringify({ credentials }),
  });
}

export async function deleteCredentials(name: string): Promise<void> {
  await request(`/accounts/${encodeURIComponent(name)}/credentials`, { method: "DELETE" });
}
// --- Scrape SSE ---

export function createScrapeStream(
  daysBack: number,
  showBrowser: boolean,
  enableDetailedLogging: boolean,
  detailedLoggingLimit: number,
  concurrency: number,
  selectedAccounts: string[],
  scrapeId: string,
  onEvent: (event: SSEEvent) => void
): EventSource {
  const params = new URLSearchParams({
    daysBack: String(daysBack),
    showBrowser: String(showBrowser),
    enableDetailedLogging: String(enableDetailedLogging),
    detailedLoggingLimit: String(detailedLoggingLimit),
    concurrency: String(concurrency),
  });
  if (selectedAccounts.length > 0) {
    params.set("accounts", selectedAccounts.join(","));
  }
  if (scrapeId) {
    params.set("scrapeId", scrapeId);
  }
  const es = new EventSource(`${BASE}/scrape/stream?${params}`);

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as SSEEvent;
      onEvent(data);
      if (data.type === "done" || data.type === "error") {
        es.close();
      }
    } catch {
      // ignore parse errors
    }
  };

  es.onerror = () => {
    es.close();
    onEvent({ type: "error", message: "Connection to server lost" });
  };

  return es;
}

export async function cancelScrape(scrapeId: string): Promise<void> {
  await request("/scrape/cancel", {
    method: "POST",
    body: JSON.stringify({ scrapeId }),
  });
}
// --- Export ---

export async function exportCSV(body: {
  rows: YnabRow[];
  outputDir: string;
  split: boolean;
  auditLog: Record<string, unknown>;
}): Promise<{ csvPaths: string[]; auditLogPath: string }> {
  return request("/export", { method: "POST", body: JSON.stringify(body) });
}

export async function openPath(path: string): Promise<{ path: string }> {
  return request("/open-path", { method: "POST", body: JSON.stringify({ path }) });
}


