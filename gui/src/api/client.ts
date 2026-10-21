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

/** YNAB write. categoryId null clears the category (Inbox Undo only). */
export async function acceptCategory(id: string, categoryId: string | null): Promise<void> {
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
  /** The period ends the day before payday. */
  payday: "month-start" | number;
  buffer: number;
  flexibleCategoryIds: string[];
  essentialCategoryIds: string[];
  essentialsOverride: { period: string; amounts: Record<string, number> } | null;
  cardWarningLevel: number;
  creditLimits: CreditLimitGroup[];
  ignoredSuggestions: string[];
  baselineMonths: number;
  dismissedAnomalies: string[];
  createdScheduleIds: string[];
  refundLinks: Array<{ refundTxId: string; purchaseTxId: string }>;
  incomeMarks: Record<string, IncomeMark>;
  toCheck: Array<{ id: string; title: string; detail: string; date: string; amount: number }>;
  /** Old keys: the server no longer returns them. Sent by the old Setup page until phase 11. */
  periodEnd?: "month-end" | number;
  overdraft?: { limitAccountId: string; accountId: string } | null;
  subtractExpected?: boolean;
}

/** One transaction behind a figure. */
export interface TxRef {
  id: string;
  date: string;
  /** Show with dir="auto". */
  payee: string;
  account: string;
  category: string | null;
  /** Signed, as in YNAB. */
  amount: number;
}

export type CategoryType = "essential" | "occasional" | "fixed";

export interface CategoryComparison {
  categoryId: string;
  name: string;
  type: CategoryType;
  thisMonth: number;
  compareTo: number;
  compareLabel: "normal by this day" | "12-month average" | "normal month";
  difference: number;
  items: TxRef[];
}

export interface SpentVsIncome {
  month: string;
  spent: number;
  income: number;
  /** income − spent; negative = spent more than earned. */
  difference: number;
  daysLeft: number;
  incomeParts: Array<{ label: string; amount: number; items: Array<TxRef & { oneTime: boolean }> }>;
  /** A refund linked by "Treat as refund" shows the purchase it belongs to. */
  spendingItems: Array<TxRef & { refundOf?: { payee: string; date: string } }>;
  savedThisMonth: { amount: number; items: TxRef[] };
  reasons: CategoryComparison[];
  uncategorized: { amount: number; count: number };
}

export interface AvailableItem {
  label: string;
  /** Signed: negative lowers the total. */
  amount: number;
  date?: string;
  txId?: string;
  categoryId?: string;
  assigned?: number;
  normal?: number;
}

export interface AvailableUntilPayday {
  periodEnd: string;
  total: number;
  lines: Array<{ key: "cash" | "cards" | "bills" | "essentials" | "buffer"; label: string; amount: number; items: AvailableItem[] }>;
  warnings: string[];
  essentialsNotChosen: boolean;
  essentialsOverridden: boolean;
}

export interface CardGroup {
  name: string;
  limit: number | null;
  balance: number;
  futureInstallments: number;
  futureInterest: number;
  unexplained: number;
  headroom: number | null;
  state: "ok" | "low" | "over" | "no-limit";
  nextPayment: {
    date: string | null;
    total: number;
    newPurchases: { amount: number; items: TxRef[] };
    olderInstallments: { amount: number; items: Array<TxRef & { payment: string }> };
  };
  futureByMonth: Array<{
    month: string;
    amount: number;
    plans: Array<{ payee: string; account: string; payment: number; paymentsLeft: number }>;
  }>;
}

export interface WatchItem {
  kind: "card-low" | "card-over" | "essential-over-pace" | "to-check";
  label: string;
  target: { tab: "cards"; group: string } | { tab: "home"; categoryId: string } | { tab: "check"; id: string };
}

export interface Pace {
  name: string;
  normalMonth: number;
  normalByToday: number;
  thisMonth: number;
  difference: number | null;
  status: "under" | "on" | "over" | "fixed-paid" | "fixed-due";
}

/** A reconcile difference: a bank row YNAB does not have, or a YNAB transaction the scrapes do not have. */
export interface MissingItem {
  id: string;
  side: "not-in-ynab" | "not-in-bank";
  accountName: string;
  date: string;
  /** Signed milliunits. */
  amount: number;
  payee: string;
}

/** YNAB write: imports one missing bank row. Only from the user's Import click. Returns the new transaction id. */
export async function importMissing(id: string): Promise<string> {
  return (await request<{ transactionId: string }>(`/spending/missing/${encodeURIComponent(id)}/import`, { method: "POST" })).transactionId;
}

/** YNAB write: Undo of Import. Deletes the transaction that Import added. */
export async function deleteImported(transactionId: string): Promise<void> {
  await request(`/spending/missing/imported/${encodeURIComponent(transactionId)}`, { method: "DELETE" });
}

export interface Anomaly {
  id: string;
  kind: "unusual-charge" | "new-payee" | "duplicate" | "category-spike" | "price-increase" | "installment-twice" | "full-and-installments";
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
  today: string;
  /** When the server read these numbers from YNAB. */
  ynabReadAt?: string;
  lastScrapedAt: string | null;
  spentVsIncome: SpentVsIncome;
  available: AvailableUntilPayday;
  cards: CardGroup[];
  watch: WatchItem[];
  settings: SpendingSettings;
  obligations: Array<{
    month: string;
    installments: number;
    scheduled: number;
    total: number;
    items: {
      scheduled: Array<{ label: string; date: string; amount: number }>;
      installments: Array<{ payee: string; account: string; payment: number; paymentsLeft: number }>;
    };
  }>;
  suggestions: ScheduleSuggestion[];
  uncategorizedCount: number;
  anomalies: Anomaly[];
  missing: MissingItem[];
  accounts: Array<{ id: string; name: string; type: string; balance: number }>;
  categories: CategoryOption[];
}

/** quick: after a settings change; the server reuses its last YNAB read. */
/** quick: only the settings changed. fresh: the Refresh button; the server reads YNAB now. */
export async function getSpending(options: { quick?: boolean; fresh?: boolean } = {}): Promise<SpendingData> {
  return request(options.fresh ? "/spending?fresh=1" : options.quick ? "/spending?quick=1" : "/spending");
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
}): Promise<string> {
  return (await request<{ ok: true; id: string }>("/spending/scheduled", { method: "POST", body: JSON.stringify(s) })).id;
}

export async function ignoreScheduleSuggestion(id: string): Promise<void> {
  await request("/spending/ignore", { method: "POST", body: JSON.stringify({ id }) });
}

// --- Treat as refund ---

export interface Purchase {
  id: string;
  date: string;
  payee: string;
  account: string;
  category: string | null;
  categoryId: string;
  amount: number;
}

/** Purchases of the last 90 days with one category, newest first. */
export async function getPurchases(): Promise<Purchase[]> {
  return (await request<{ purchases: Purchase[] }>("/spending/purchases")).purchases;
}

/** YNAB write: the refund gets the purchase's category. Only from the user's click. */
export async function treatAsRefund(refundTxId: string, purchaseTxId: string): Promise<void> {
  await request("/spending/refund", { method: "POST", body: JSON.stringify({ refundTxId, purchaseTxId }) });
}

// --- Income marks (local only) ---

/** "not-income": leave a money-in entry out (a reconciliation). "income": count it (a transfer, for example). */
export type IncomeMark = "income" | "not-income";

export interface Inflow {
  id: string;
  date: string;
  payee: string;
  account: string;
  category: string | null;
  transfer: boolean;
  amount: number;
  mark: IncomeMark | null;
}

/** Money-in transactions of the last 120 days, transfers included. */
export async function getInflows(): Promise<Inflow[]> {
  return (await request<{ inflows: Inflow[] }>("/spending/inflows")).inflows;
}

export async function setIncomeMark(id: string, mark: IncomeMark | null): Promise<void> {
  await request("/spending/income-marks", { method: "POST", body: JSON.stringify({ id, mark }) });
}

// --- Inbox Undo ---

/** "Check it": puts an unusual item on the To check list (Things to watch). Local only. */
export async function checkAnomaly(a: Pick<Anomaly, "id" | "title" | "detail" | "date" | "amount">): Promise<void> {
  const { id, ...item } = a;
  await request(`/spending/anomalies/${encodeURIComponent(id)}/check`, { method: "POST", body: JSON.stringify(item) });
}

export async function uncheckAnomaly(id: string): Promise<void> {
  await request(`/spending/anomalies/${encodeURIComponent(id)}/uncheck`, { method: "POST" });
}

export async function restoreAnomaly(id: string): Promise<void> {
  await request(`/spending/anomalies/${encodeURIComponent(id)}/restore`, { method: "POST" });
}

export async function restoreScheduleSuggestion(id: string): Promise<void> {
  await request(`/spending/suggestions/${encodeURIComponent(id)}/restore`, { method: "POST" });
}

/** YNAB write: deletes a schedule that this app created. Only from the user's Undo click. */
export async function deleteCreatedScheduled(id: string): Promise<void> {
  await request(`/spending/scheduled/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Reports ---

/** "monthly" is made now; the others are older saved reports, still readable. */
export type ReportType = "monthly" | "weekly" | "month-start" | "month-end";

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
    chart?: Array<{ month: string; income: number; spent: number }>;
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
