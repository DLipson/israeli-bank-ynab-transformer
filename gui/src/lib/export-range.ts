/** Month arithmetic for the month export. Months are "yyyy-mm". */

function key(year: number, monthIndex: number): string {
  const d = new Date(year, monthIndex, 1); // Date normalizes month overflow across years
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shift(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return key(y, m - 1 + delta);
}

export function lastFullMonth(now: Date): string {
  return key(now.getFullYear(), now.getMonth() - 1);
}

/** The last n months, newest first, ending at the current month. */
export function recentMonths(now: Date, n: number): string[] {
  return Array.from({ length: n }, (_, i) => key(now.getFullYear(), now.getMonth() - i));
}

/** The range of `count` months that ends at endMonth. */
export function exportRange(endMonth: string, count: number): { from: string; to: string } {
  return { from: shift(endMonth, -(count - 1)), to: endMonth };
}
