export interface YnabCategory {
  id: string;
  name: string;
  balance: number;
  hidden?: boolean;
  deleted?: boolean;
  category_group_name?: string;
}

export interface YnabCategoryGroup {
  id: string;
  name: string;
  hidden?: boolean;
  deleted?: boolean;
  categories: YnabCategory[];
}

export interface CategorySelection {
  id: string;
  label?: string;
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

export interface BuildCategoryAvailabilityReportInput {
  budgetId: string;
  categoryGroups: YnabCategoryGroup[];
  selectedCategories: CategorySelection[];
  timezone?: string;
  currency?: string;
  locale?: string;
  yellowThresholdMilliunits?: number;
  now?: Date;
}

export interface GetCategoryAvailabilityReportInput {
  token: string;
  budgetId: string;
  selectedCategories: CategorySelection[];
  timezone?: string;
  currency?: string;
  locale?: string;
  yellowThresholdMilliunits?: number;
  now?: Date;
  fetchCategoryGroups?: (token: string, budgetId: string) => Promise<YnabCategoryGroup[]>;
}

interface YnabCategoryGroupsResponse {
  data?: {
    category_groups?: YnabCategoryGroup[];
  };
  error?: {
    detail?: string;
  };
}

const DEFAULT_TIMEZONE = "Asia/Jerusalem";
const DEFAULT_CURRENCY = "ILS";
const DEFAULT_LOCALE = "en-IL";
const DEFAULT_YELLOW_THRESHOLD_MILLIUNITS = 200_000;

function normalizeSelection(selection: CategorySelection[]): CategorySelection[] {
  return selection
    .map((item) => ({
      id: item.id.trim(),
      label: item.label?.trim(),
    }))
    .filter((item) => item.id.length > 0);
}

function classifyStatus(value: number, yellowThresholdMilliunits: number): ReportStatus {
  if (value < 0) return "red";
  if (value < yellowThresholdMilliunits) return "yellow";
  return "green";
}

function getStatusOrder(status: ReportStatus): number {
  if (status === "red") return 0;
  if (status === "yellow") return 1;
  return 2;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function flattenVisibleCategories(categoryGroups: YnabCategoryGroup[]): Map<string, YnabCategory & { groupName: string }> {
  const byId = new Map<string, YnabCategory & { groupName: string }>();

  for (const group of categoryGroups) {
    if (group.deleted || group.hidden) continue;
    for (const category of group.categories ?? []) {
      if (category.deleted || category.hidden) continue;
      byId.set(category.id, {
        ...category,
        groupName: category.category_group_name ?? group.name,
      });
    }
  }

  return byId;
}

function formatAvailable(valueMilliunits: number, locale: string, currency: string): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(valueMilliunits / 1000);
}

export function buildCategoryAvailabilityReport(
  input: BuildCategoryAvailabilityReportInput
): CategoryAvailabilityReport {
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const currency = input.currency ?? DEFAULT_CURRENCY;
  const locale = input.locale ?? DEFAULT_LOCALE;
  const yellowThresholdMilliunits =
    input.yellowThresholdMilliunits ?? DEFAULT_YELLOW_THRESHOLD_MILLIUNITS;
  const selectedCategories = normalizeSelection(input.selectedCategories);

  if (!input.budgetId.trim()) {
    throw new Error("Budget id is required.");
  }
  if (selectedCategories.length === 0) {
    throw new Error("At least one selected category is required.");
  }

  const now = input.now ?? new Date();
  const availableById = flattenVisibleCategories(input.categoryGroups);
  const missingIds: string[] = [];
  const rows: CategoryAvailabilityRow[] = [];

  for (const selected of selectedCategories) {
    const category = availableById.get(selected.id);
    if (!category) {
      missingIds.push(selected.id);
      continue;
    }

    const status = classifyStatus(category.balance, yellowThresholdMilliunits);
    rows.push({
      id: category.id,
      name: selected.label && selected.label.length > 0 ? selected.label : category.name,
      groupName: category.groupName,
      availableMilliunits: category.balance,
      available: formatAvailable(category.balance, locale, currency),
      status,
    });
  }

  if (missingIds.length > 0) {
    throw new Error(`Missing selected categories in budget: ${missingIds.join(", ")}`);
  }

  rows.sort((a, b) => {
    const orderDiff = getStatusOrder(a.status) - getStatusOrder(b.status);
    if (orderDiff !== 0) return orderDiff;
    const amountDiff = a.availableMilliunits - b.availableMilliunits;
    if (amountDiff !== 0) return amountDiff;
    return a.name.localeCompare(b.name);
  });

  const totals = {
    red: rows.filter((row) => row.status === "red").length,
    yellow: rows.filter((row) => row.status === "yellow").length,
    green: rows.filter((row) => row.status === "green").length,
    count: rows.length,
  };

  const generatedAtLocal = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(now);

  return {
    budgetId: input.budgetId,
    timezone,
    currency,
    generatedAtIso: now.toISOString(),
    generatedAtLocal,
    rows,
    totals,
  };
}

export async function fetchYnabCategoryGroups(
  token: string,
  budgetId: string
): Promise<YnabCategoryGroup[]> {
  const response = await fetch(`https://api.ynab.com/v1/budgets/${budgetId}/categories`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`YNAB categories request failed: ${response.status} ${response.statusText} ${text}`);
  }

  const payload = (await response.json()) as YnabCategoryGroupsResponse;
  if (payload.error?.detail) {
    throw new Error(`YNAB API error: ${payload.error.detail}`);
  }

  const groups = payload.data?.category_groups;
  if (!groups) {
    throw new Error("YNAB categories response is missing category_groups.");
  }

  return groups;
}

export async function getCategoryAvailabilityReport(
  input: GetCategoryAvailabilityReportInput
): Promise<CategoryAvailabilityReport> {
  const token = input.token.trim();
  if (!token) {
    throw new Error("YNAB API token is required.");
  }
  if (!input.budgetId.trim()) {
    throw new Error("Budget id is required.");
  }

  const fetchCategoryGroups = input.fetchCategoryGroups ?? fetchYnabCategoryGroups;
  const categoryGroups = await fetchCategoryGroups(token, input.budgetId);

  return buildCategoryAvailabilityReport({
    budgetId: input.budgetId,
    categoryGroups,
    selectedCategories: input.selectedCategories,
    timezone: input.timezone,
    currency: input.currency,
    locale: input.locale,
    yellowThresholdMilliunits: input.yellowThresholdMilliunits,
    now: input.now,
  });
}

function statusStyles(status: ReportStatus): { label: string; background: string; color: string } {
  if (status === "red") {
    return { label: "Red", background: "#fee2e2", color: "#991b1b" };
  }
  if (status === "yellow") {
    return { label: "Yellow", background: "#fef9c3", color: "#854d0e" };
  }
  return { label: "Green", background: "#dcfce7", color: "#166534" };
}

export function buildCategoryAvailabilityHtml(report: CategoryAvailabilityReport): string {
  const rows = report.rows
    .map((row) => {
      const style = statusStyles(row.status);
      return `<tr>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;">
    <span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${style.background};color:${style.color};font-weight:700;font-size:12px;">${style.label}</span>
  </td>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.name)}</td>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${escapeHtml(row.groupName)}</td>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(row.available)}</td>
</tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
<body style="font-family:Arial,sans-serif;color:#111827;">
  <h2 style="margin:0 0 10px 0;">YNAB Category Availability</h2>
  <p style="margin:0 0 12px 0;color:#4b5563;">Generated ${escapeHtml(report.generatedAtLocal)} (${escapeHtml(report.timezone)})</p>
  <p style="margin:0 0 16px 0;font-weight:600;">Red: ${report.totals.red} | Yellow: ${report.totals.yellow} | Green: ${report.totals.green}</p>
  <table style="width:100%;border-collapse:collapse;">
    <thead>
      <tr>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Status</th>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Category</th>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Group</th>
        <th style="text-align:right;padding:8px;border-bottom:2px solid #d1d5db;">Available</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}
