// Compare the saved scrape runs (what the banks reported) with YNAB, per account. Read-only.
// Usage: npx tsx scripts/reconcile.ts
import { loadAppEnv } from "../src/env.js";
import { getYnabToken } from "../src/ynab/import-service.js";
import { getReconcile } from "../src/engine/reconcile-service.js";

loadAppEnv();
const f = (milli: number) => (milli / 1000).toFixed(2).padStart(10);

for (const r of await getReconcile(getYnabToken())) {
  const ok = r.missingInYnab.length + r.missingInBank.length === 0;
  console.log(`\n== ${r.accountName} (${r.source}) ${r.from}..${r.to}: ${r.matched} matched${ok ? ", OK" : ""}`);
  for (const b of r.missingInYnab) console.log(`   not in YNAB  ${b.date} ${f(b.amount)}  ${b.payee}`);
  for (const t of r.missingInBank) console.log(`   not in bank  ${t.date} ${f(t.amount)}  ${t.payee_name ?? ""}`);
  const b = r.balance;
  console.log(`   reconciled ${b.reconciledDate ?? "never"}: ${f(b.reconciledBalance)}`);
  console.log(`   + scrape since (${b.scrapeRows} rows):  ${f(b.scrapeTotal)}`);
  if (b.expected === null) console.log(`   = by the scrape: -  (${b.note})`);
  else console.log(`   = by the scrape: ${f(b.expected)}   YNAB now: ${f(b.ynabBalance)}   difference: ${f(b.ynabBalance - b.expected)}`);
}
