import { readMemoFields } from "../ynab/categorize.js";

/** Returns a memo's chargeDate as ISO, accepting the importer's old dd/mm/yyyy format. */
export function parseChargeDate(memo: string | null): string | null {
  const value = readMemoFields(memo)?.chargeDate;
  if (typeof value !== "string") return null;

  const date = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const old = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  if (!iso && !old) return null;

  const year = Number(iso?.[1] ?? old?.[3]);
  const month = Number(iso?.[2] ?? old?.[2]);
  const day = Number(iso?.[3] ?? old?.[1]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
