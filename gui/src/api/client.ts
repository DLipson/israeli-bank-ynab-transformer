const BASE = "/api";

export interface AccountInfo {
  name: string;
  companyId: string;
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

export interface ScrapeResultInfo {
  accountName: string;
  success: boolean;
  transactionCount: number;
  error?: string;
}

export interface TransactionSummary {
  byAccount: Record<string, AccountSummaryData>;
  totalOutflow: number;
  totalInflow: number;
}

export interface ScrapePayload {
  scrapeResults: ScrapeResultInfo[];
  kept: Record<string, unknown>[];
  skipped: SkippedItem[];
  rows: YnabRow[];
  summary: TransactionSummary;
  auditLog?: any;
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

export interface ReconcileResult {
  sourceFile: string;
  targetFile: string;
  sourceCount: number;
  targetCount: number;
  matched: Array<{ source: NormalizedTransaction; target: NormalizedTransaction }>;
  flagged: Array<{
    source: NormalizedTransaction;
    target: NormalizedTransaction;
    dateDiff: number;
  }>;
  missingFromTarget: NormalizedTransaction[];
  extraInTarget: NormalizedTransaction[];
}

export interface NormalizedTransaction {
  transactionDate: string;
  chargeDate: string;
  payee: string;
  outflow: number;
  inflow: number;
  originalAmount: number | null;
  notes: string;
  source: string;
}

export type ReportStatus = "red" | "yellow" | "green";

export interface CategoryAvailabilityRow {
  id: string;
  name: string;
  groupName: string;
  availableMilliunits: number;
  available: string;
  status: ReportStatus;
}

export interface CategoryAvailabilityReport {
  budgetId: string;
  timezone: string;
  currency: string;
  generatedAtIso: string;
  generatedAtLocal: string;
  rows: CategoryAvailabilityRow[];
  totals: {
    red: number;
    yellow: number;
    green: number;
    count: number;
  };
}

export interface CategoryReportPreviewResponse {
  report: CategoryAvailabilityReport;
  html: string;
}

export interface SendTestCategoryReportEmailResponse {
  recipientEmail: string;
  subject: string;
  totals: {
    red: number;
    yellow: number;
    green: number;
    count: number;
  };
}

// --- Accounts ---

export async function getAccounts(): Promise<AccountInfo[]> {
  const res = await fetch(`${BASE}/accounts`);
  const data = await res.json();
  return data.accounts;
}

export async function saveCredentials(
  name: string,
  credentials: Record<string, string>
): Promise<void> {
  const res = await fetch(`${BASE}/accounts/${encodeURIComponent(name)}/credentials`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credentials }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to save credentials");
  }
}

export async function deleteCredentials(name: string): Promise<void> {
  const res = await fetch(`${BASE}/accounts/${encodeURIComponent(name)}/credentials`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to delete credentials");
  }
}

// --- Scrape SSE ---

export function createScrapeStream(
  daysBack: number,
  showBrowser: boolean,
  enableDetailedLogging: boolean,
  detailedLoggingLimit: number,
  selectedAccounts: string[],
  scrapeId: string,
  onEvent: (event: SSEEvent) => void
): EventSource {
  const params = new URLSearchParams({
    daysBack: String(daysBack),
    showBrowser: String(showBrowser),
    enableDetailedLogging: String(enableDetailedLogging),
    detailedLoggingLimit: String(detailedLoggingLimit),
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
  const res = await fetch(`${BASE}/scrape/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scrapeId }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to cancel scrape");
  }
}

// --- Export ---

export async function exportCSV(body: {
  rows: YnabRow[];
  outputDir: string;
  split: boolean;
  scrapeResults: ScrapeResultInfo[];
  skipped: SkippedItem[];
  auditLog?: any;
}): Promise<{ csvPaths: string[]; auditLogPath: string }> {
  const res = await fetch(`${BASE}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Export failed");
  }
  return res.json();
}

export async function openPath(path: string): Promise<{ path: string }> {
  const res = await fetch(`${BASE}/open-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to open path");
  }
  return res.json();
}

// --- Reconcile ---

export async function reconcile(body: {
  sourceContent: string;
  targetContent: string;
  sourceLabel: string;
  targetLabel: string;
}): Promise<ReconcileResult> {
  const res = await fetch(`${BASE}/reconcile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Reconcile failed");
  }
  return res.json();
}

// --- Category Report ---

export async function previewCategoryReport(): Promise<CategoryReportPreviewResponse> {
  const res = await fetch(`${BASE}/report/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Report preview failed");
  }
  return res.json();
}

export async function sendTestCategoryReportEmail(): Promise<SendTestCategoryReportEmailResponse> {
  const res = await fetch(`${BASE}/report/send-test-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to send test email");
  }
  return res.json();
}
