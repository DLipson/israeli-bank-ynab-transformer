const BASE = "/api";

export interface AccountInfo {
  name: string;
  bankName: string;
  companyId: string;
  fields: string[];
  enabled: boolean;
  primary: boolean;
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
  runId?: string;
}

export interface SSEEvent {
  type: "warning" | "progress" | "account-done" | "done" | "error";
  message?: string;
  account?: string;
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
  const data = await res.json().catch(() => {
    throw new Error(`Server returned ${res.status} (not JSON) for ${path}. Restart the server if it is outdated.`);
  });
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

export async function createAccount(bankName: string, accountName: string): Promise<void> {
  await request("/accounts", { method: "POST", body: JSON.stringify({ bankName, accountName }) });
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
  runId?: string;
}): Promise<{ csvPaths: string[]; auditLogPath: string }> {
  return request("/export", { method: "POST", body: JSON.stringify(body) });
}

export async function openPath(path: string): Promise<{ path: string }> {
  return request("/open-path", { method: "POST", body: JSON.stringify({ path }) });
}



// --- YNAB ---

export interface YnabOption {
  id: string;
  name: string;
}

export interface YnabImportConfig {
  budgetId: string;
  mappings: Record<string, string>;
}

export interface YnabImportResult {
  imported: number;
  duplicates: number;
  unmapped: string[];
}

export async function getYnabBudgets(): Promise<YnabOption[]> {
  return (await request<{ budgets: YnabOption[] }>("/ynab/budgets")).budgets;
}

export async function getYnabAccounts(budgetId: string): Promise<YnabOption[]> {
  return (await request<{ accounts: YnabOption[] }>(`/ynab/budgets/${encodeURIComponent(budgetId)}/accounts`))
    .accounts;
}

export async function getYnabImportConfig(): Promise<YnabImportConfig> {
  return request("/ynab/import-config");
}

export async function saveYnabImportConfig(config: YnabImportConfig): Promise<YnabImportConfig> {
  return request("/ynab/import-config", { method: "PUT", body: JSON.stringify(config) });
}

export async function importToYnab(rows: YnabRow[], runId?: string): Promise<YnabImportResult> {
  return request("/ynab/import", { method: "POST", body: JSON.stringify({ rows, runId }) });
}

export async function getYnabTokenStatus(): Promise<{ saved: boolean }> {
  return request("/ynab/token");
}

export async function saveYnabToken(token: string): Promise<{ saved: boolean }> {
  return request("/ynab/token", { method: "PUT", body: JSON.stringify({ token }) });
}

// --- History ---

export interface RunSummary {
  id: string;
  createdAt: string;
  settings: { daysBack: number; accounts: string[] };
  accounts: Array<{ accountName: string; success: boolean; transactionCount: number; error?: string }>;
  exports: Array<{ at: string; csvPaths: string[]; auditLogPath: string }>;
  ynabImports: Array<{ at: string } & YnabImportResult>;
  rowCount: number;
  totalOutflow: number;
  totalInflow: number;
}

export type RunRecord = Omit<RunSummary, "rowCount" | "totalOutflow" | "totalInflow"> & {
  payload: ScrapePayload;
};

export async function getRuns(): Promise<RunSummary[]> {
  return (await request<{ runs: RunSummary[] }>("/history")).runs;
}

export async function getRun(id: string): Promise<RunRecord> {
  return request(`/history/${encodeURIComponent(id)}`);
}

// --- Categorize ---

export type Evidence = "history" | "sector" | "name" | "memo" | "web";

export interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  evidence: Evidence;
  note: string;
  source?: string;
  share?: number;
  sampleSize?: number;
}

export interface CategoryOption {
  id: string;
  name: string;
  group: string;
}

export interface CategorizeItem {
  id: string;
  date: string;
  amount: number;
  payee: string;
  account: string;
  bankText: string;
  handNote: string;
  merchant: string;
  sector: string;
  kind: "person" | "cash" | "other";
  suggestions: CategorySuggestion[];
  llm: boolean;
}

/** sync=false reuses the server's last YNAB sync (for a change of days). */
export async function getCategorizeList(
  days = 31,
  sync = true
): Promise<{ items: CategorizeItem[]; categories: CategoryOption[]; searchKeySaved: boolean }> {
  return request(`/categorize?days=${days}${sync ? "" : "&sync=0"}`);
}

export async function getLlmSuggestions(ids: string[]): Promise<Record<string, CategorySuggestion[]>> {
  return (await request<{ suggestions: Record<string, CategorySuggestion[]> }>("/categorize/llm", {
    method: "POST",
    body: JSON.stringify({ ids }),
  })).suggestions;
}

export async function acceptCategory(id: string, categoryId: string): Promise<void> {
  await request("/categorize/accept", { method: "POST", body: JSON.stringify({ id, categoryId }) });
}

export async function rejectCategory(id: string, categoryId: string): Promise<void> {
  await request("/categorize/reject", { method: "POST", body: JSON.stringify({ id, categoryId }) });
}

export async function saveSearchKey(key: string): Promise<void> {
  await request("/categorize/search-key", { method: "PUT", body: JSON.stringify({ key }) });
}

// --- Spending (safe-spending engine). Amounts are YNAB milliunits. ---

export interface SpendingLine {
  label: string;
  amount: number;
}

export interface LeftToSpend {
  total: number;
  lines: SpendingLine[];
  warnings: string[];
}

export interface CreditLimitGroup {
  name: string;
  limit: number;
  accountIds: string[];
}

export interface SpendingSettings {
  mode: "cashflow" | "ynab";
  periodEnd: "month-end" | number;
  buffer: number;
  flexibleCategoryIds: string[];
  creditLimits: CreditLimitGroup[];
  overdraft: { limitAccountId: string; accountId: string } | null;
  ignoredSuggestions: string[];
  baselineMonths: number;
  subtractExpected: boolean;
}

export interface Pace {
  name: string;
  normalMonth: number;
  normalByToday: number;
  thisMonth: number;
  difference: number | null;
  status: "under" | "on" | "over" | "fixed-paid" | "fixed-due";
}

export interface Anomaly {
  id: string;
  kind: "unusual-charge" | "new-payee" | "duplicate" | "category-spike" | "price-increase";
  date: string;
  title: string;
  detail: string;
  amount: number;
  transactionIds: string[];
}

export interface Baseline {
  months: number;
  asOf: string;
  total: Pace;
  categories: Pace[];
  uncategorized: number;
  topOver: Pace[];
}

export interface ScheduleSuggestion {
  id: string;
  label: string;
  accountId: string;
  amount: number;
  dayOfMonth: number;
  nextDate: string;
  categoryId: string | null;
  amountVaries: boolean;
  months: number;
}

export interface SpendingData {
  monthlyFlow: {
    month: string;
    expenses: number;
    planActivity: number | null;
    income: number;
    incomeThisMonth: number;
    carriedIncome: number;
    carryoverFrom: string;
    carryoverTo: string;
  };
  today: string;
  lastScrapedAt: string | null;
  periodEnd: string;
  settings: SpendingSettings;
  cashflow: LeftToSpend;
  ynab: LeftToSpend;
  gap: number;
  readyToAssign: number;
  exposure: Array<{ name: string; limit: number | null; used: number; unused: number | null; lines: SpendingLine[] }>;
  obligations: Array<{ month: string; installments: number; scheduled: number; total: number }>;
  suggestions: ScheduleSuggestion[];
  scheduledCount: number;
  baseline: Baseline;
  uncategorizedCount: number;
  anomalies: Anomaly[];
  accounts: Array<{ id: string; name: string; type: string; balance: number }>;
  categories: CategoryOption[];
}

export async function getSpending(): Promise<SpendingData> {
  return request("/spending");
}

export async function saveSpendingSettings(settings: Partial<SpendingSettings>): Promise<SpendingSettings> {
  return request("/spending/settings", { method: "PUT", body: JSON.stringify(settings) });
}

export async function createScheduled(s: {
  accountId: string;
  date: string;
  amount: number;
  payeeName: string;
  categoryId: string | null;
}): Promise<void> {
  await request("/spending/scheduled", { method: "POST", body: JSON.stringify(s) });
}

export async function ignoreScheduleSuggestion(id: string): Promise<void> {
  await request("/spending/ignore", { method: "POST", body: JSON.stringify({ id }) });
}

// --- Reports ---

export type ReportType = "weekly" | "month-start" | "month-end";

export interface Report {
  type: ReportType;
  title: string;
  generatedAt: string;
  dataAsOf: string;
  /** Missing on reports saved before scrape timestamps were recorded. */
  lastScrapedAt?: string | null;
  sections: Array<{
    title: string;
    rows: Array<{ label: string; value: string; tone?: "good" | "bad" | "warn" | "muted" }>;
    note?: string;
    explanation?: string;
    details?: Array<{ label: string; value: string; tone?: "good" | "bad" | "warn" | "muted" }>;
  }>;
}

export async function getReports(): Promise<Record<ReportType, Report | null>> {
  return request("/spending/reports");
}

export async function generateReport(type: ReportType): Promise<Report> {
  return request(`/spending/reports/${type}`, { method: "POST" });
}

// --- Reconcile ---

export interface AccountReconcile {
  source: string;
  accountId: string;
  accountName: string;
  from: string;
  to: string;
  matched: number;
  missingInYnab: Array<{ date: string; amount: number; payee: string }>;
  missingInBank: Array<{ id: string; date: string; amount: number; payee_name: string | null }>;
  balance: {
    reconciledDate: string | null;
    reconciledBalance: number;
    scrapeTotal: number;
    scrapeRows: number;
    expected: number | null;
    ynabBalance: number;
    note?: string;
  };
}

export async function getReconcile(): Promise<AccountReconcile[]> {
  return (await request<{ accounts: AccountReconcile[] }>("/spending/reconcile")).accounts;
}

export async function dismissAnomaly(id: string): Promise<void> {
  await request("/spending/anomalies/dismiss", { method: "POST", body: JSON.stringify({ id }) });
}
