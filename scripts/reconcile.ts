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
}
