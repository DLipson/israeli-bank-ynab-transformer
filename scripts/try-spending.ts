// Manual check of the safe-spending engine against real data. Read-only: it never writes to YNAB.
// Usage: npx tsx scripts/try-spending.ts
import { loadAppEnv } from "../src/env.js";
import { getYnabToken } from "../src/ynab/import-service.js";
import { getSpending } from "../src/engine/safe-spending-service.js";
import { formatShekels as f } from "../src/engine/safe-spending.js";

loadAppEnv();
const s = await getSpending(getYnabToken());
const show = (title: string, r: { total: number; lines: Array<{ label: string; amount: number }>; warnings: string[] }) => {
  console.log(`\n== ${title}: ${f(r.total)}`);
  for (const l of r.lines) console.log(`   ${l.label.padEnd(44)} ${f(l.amount).padStart(10)}`);
  for (const w of r.warnings) console.log(`   ! ${w}`);
};
console.log(`today ${s.today}, period end ${s.periodEnd}, mode ${s.settings.mode}`);
show("A. Cash-flow", s.cashflow);
show("B. YNAB categories", s.ynab);
console.log(`\ngap A - B: ${f(s.gap)}`);
console.log("\n== Credit exposure");
for (const g of s.exposure) {
  const limit = g.limit === null ? "not set" : f(g.limit);
  const unused = g.unused === null ? "-" : f(g.unused);
  console.log(`   ${g.name.padEnd(16)} limit ${limit}  used ${f(g.used)}  unused ${unused}`);
}
console.log("\n== Obligations (next months)");
console.log("   " + s.obligations.map((o) => `${o.month}: ${f(o.total)}`).join(", "));
console.log(`\n== Scheduled transactions in YNAB: ${s.scheduledCount}. Suggested:`);
for (const p of s.suggestions) {
  const account = s.accounts.find((a) => a.id === p.accountId)?.name;
  const category = s.categories.find((c) => c.id === p.categoryId)?.name ?? "no category";
  console.log(`   ${p.nextDate}  ${f(p.amount).padStart(8)}${p.amountVaries ? " (varies)" : "         "}  ${p.label}  (${account}; ${category})`);
}
