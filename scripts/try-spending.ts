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
const b = s.baseline;
const pct = (d: number | null) => (d === null ? "" : `${d > 0 ? "+" : ""}${Math.round(d * 100)}%`);
console.log(`\n== Baseline (${b.months} months). Total: normal month ${f(b.total.normalMonth)}, normal by today ${f(b.total.normalByToday)}, this month ${f(b.total.thisMonth)} ${pct(b.total.difference)} ${b.total.status}`);
for (const c of b.categories.slice(0, 15)) console.log(`   ${c.name.slice(0, 28).padEnd(28)} normal ${f(c.normalMonth).padStart(8)}  by today ${f(c.normalByToday).padStart(8)}  now ${f(c.thisMonth).padStart(8)}  ${c.status} ${pct(c.difference)}`);
console.log("   top over pace:", b.topOver.map((c) => `${c.name} ${pct(c.difference)}`).join(", ") || "none");
console.log(`\n== Unusual (${s.anomalies.length})`);
for (const a of s.anomalies) console.log(`   ${a.date} [${a.kind}] ${a.title} — ${a.detail}`);
