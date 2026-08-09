import { formatDate, parseDate } from "./transformer.js";

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

const COLUMN_MAPPING: Record<string, keyof NormalizedTransaction> = {
  // Hebrew bank columns
  "תאריך": "chargeDate",
  "תאריך ערך": "transactionDate",
  "תיאור": "payee",
  "בחובה": "outflow",
  "בזכות": "inflow",
  'היתרה בש"ח': "notes",
  "מספר הכרטיס": "source",
  "תאריך העסקה": "transactionDate",
  "שם בית העסק": "payee",
  "סכום העסקה": "originalAmount",
  "סכום החיוב": "outflow",
  "סוג העסקה": "notes",
  "פרטים": "notes",
  "תאריך החיוב": "chargeDate",
  "תאריך עסקה": "transactionDate",
  "4 ספרות אחרונות של כרטיס האשראי": "source",
  "סכום חיוב": "outflow",
  "סכום עסקה מקורי": "originalAmount",
  "הערות": "notes",
  "תאריך חיוב": "chargeDate",
  "תאריך רכישה": "transactionDate",
  "שם בית עסק": "payee",
  "סכום עסקה": "originalAmount",
  "פירוט נוסף": "notes",

  // English/scraper columns
  "date": "transactionDate",
  "processedDate": "chargeDate",
  "description": "payee",
  "chargedAmount": "outflow",
  "originalAmount": "originalAmount",
  "memo": "notes",
  "identifier": "notes",
  "Account": "source",
  "Date": "transactionDate",
  "Payee": "payee",
  "Memo": "notes",
  "Outflow": "outflow",
  "Inflow": "inflow",
};

export function normalizeColumnName(columnName: string): keyof NormalizedTransaction | null {
  const trimmed = columnName.trim();
  return COLUMN_MAPPING[trimmed] ?? null;
}

export function normalizeDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(trimmed) || /^\d{4}/.test(trimmed)) {
    const parsed = parseDate(trimmed);
    if (parsed) return formatDate(parsed);
  }

  return trimmed;
}

export function normalizeAmount(value: string): number {
  if (!value || typeof value !== "string") return 0;

  const cleaned = value
    .replace(/[₪$€,]/g, "")
    .replace(/\s/g, "")
    .trim();

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function normalizeRow(row: Record<string, string>): NormalizedTransaction {
  const normalized: NormalizedTransaction = {
    transactionDate: "",
    chargeDate: "",
    payee: "",
    outflow: 0,
    inflow: 0,
    originalAmount: null,
    notes: "",
    source: "",
  };

  for (const [column, value] of Object.entries(row)) {
    if (!value) continue;

    const field = normalizeColumnName(column);
    if (!field) continue;

    switch (field) {
      case "transactionDate":
      case "chargeDate":
        if (!normalized[field]) {
          normalized[field] = normalizeDate(value);
        }
        break;

      case "outflow": {
        const amount = normalizeAmount(value);
        if (amount < 0) {
          normalized.outflow = Math.abs(amount);
        } else if (amount > 0 && normalized.outflow === 0) {
          normalized.outflow = amount;
        }
        break;
      }

      case "inflow": {
        const amount = normalizeAmount(value);
        if (amount > 0) {
          normalized.inflow = amount;
        } else if (amount < 0 && normalized.inflow === 0) {
          normalized.inflow = Math.abs(amount);
        }
        break;
      }

      case "originalAmount": {
        const amount = normalizeAmount(value);
        if (amount !== 0) {
          normalized.originalAmount = Math.abs(amount);
        }
        break;
      }

      case "payee":
        if (!normalized.payee) {
          normalized.payee = value.trim();
        }
        break;

      case "notes":
        if (normalized.notes) {
          normalized.notes += ` | ${value.trim()}`;
        } else {
          normalized.notes = value.trim();
        }
        break;

      case "source":
        if (!normalized.source) {
          normalized.source = value.trim();
        }
        break;
    }
  }

  return normalized;
}

export function getEffectiveDate(txn: NormalizedTransaction): string {
  return txn.chargeDate || txn.transactionDate;
}

export function getEffectiveAmount(txn: NormalizedTransaction): number {
  if (txn.outflow > 0) return -txn.outflow;
  if (txn.inflow > 0) return txn.inflow;
  return 0;
}
