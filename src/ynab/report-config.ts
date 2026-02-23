import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CategorySelection } from "./report-service.js";
import { getCategoryReportConfigPath } from "../env.js";

interface CategoryReportConfigFile {
  budgetId?: unknown;
  categories?: unknown;
  timezone?: unknown;
  currency?: unknown;
  locale?: unknown;
  yellowThreshold?: unknown;
}

export interface CategoryReportConfig {
  budgetId: string;
  selectedCategories: CategorySelection[];
  timezone?: string;
  currency?: string;
  locale?: string;
  yellowThreshold?: number;
}

function parseSelectedCategories(raw: unknown): CategorySelection[] {
  if (!Array.isArray(raw)) {
    throw new Error("Report config categories must be an array.");
  }

  const parsed: CategorySelection[] = [];

  for (const item of raw) {
    if (typeof item === "string") {
      const id = item.trim();
      if (id.length === 0) continue;
      parsed.push({ id });
      continue;
    }

    if (typeof item === "object" && item !== null) {
      const obj = item as { id?: unknown; label?: unknown };
      if (typeof obj.id !== "string" || obj.id.trim().length === 0) {
        continue;
      }
      parsed.push({
        id: obj.id.trim(),
        label: typeof obj.label === "string" && obj.label.trim().length > 0 ? obj.label.trim() : undefined,
      });
    }
  }

  if (parsed.length === 0) {
    throw new Error("Report config must include at least one valid category.");
  }

  return parsed;
}

export function loadCategoryReportConfig(filePath?: string): CategoryReportConfig {
  const configPath = resolve(
    filePath ?? process.env.YNAB_CATEGORY_REPORT_CONFIG ?? getCategoryReportConfigPath()
  );
  if (!existsSync(configPath)) {
    throw new Error(`Report config file not found: ${configPath}`);
  }

  const content = readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(content) as CategoryReportConfigFile;

  if (typeof parsed.budgetId !== "string" || parsed.budgetId.trim().length === 0) {
    throw new Error("Report config must include a non-empty budgetId.");
  }

  const config: CategoryReportConfig = {
    budgetId: parsed.budgetId.trim(),
    selectedCategories: parseSelectedCategories(parsed.categories),
  };

  if (typeof parsed.timezone === "string" && parsed.timezone.trim().length > 0) {
    config.timezone = parsed.timezone.trim();
  }
  if (typeof parsed.currency === "string" && parsed.currency.trim().length > 0) {
    config.currency = parsed.currency.trim();
  }
  if (typeof parsed.locale === "string" && parsed.locale.trim().length > 0) {
    config.locale = parsed.locale.trim();
  }
  if (typeof parsed.yellowThreshold === "number" && Number.isFinite(parsed.yellowThreshold)) {
    config.yellowThreshold = parsed.yellowThreshold;
  }

  return config;
}
