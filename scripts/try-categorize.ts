// Manual check of the Categorize backend against real YNAB data. Read-only: it never writes to YNAB.
// Usage: npx tsx scripts/try-categorize.ts [--llm]
import { loadAppEnv } from "../src/env.js";
import { getYnabToken } from "../src/ynab/import-service.js";
import { getCategorizeList, getLlmSuggestions } from "../src/ynab/categorize-service.js";

loadAppEnv();
const { items, categories } = await getCategorizeList(getYnabToken(), 31);
console.log(`${items.length} uncategorized, ${categories.length} categories`);
for (const item of items) {
  const s = item.suggestions.map((x) => `${x.categoryName} [${x.evidence}] ${x.note}`).join(" | ") || (item.llm ? "→ LLM" : "-");
  console.log(`${item.date} ${item.kind.padEnd(6)} ${item.payee.slice(0, 28).padEnd(28)} ${s}`);
}
if (process.argv.includes("--llm")) {
  const started = Date.now();
  const llm = await getLlmSuggestions(items.filter((i) => i.llm).map((i) => i.id));
  console.log(`\nLLM (${Math.round((Date.now() - started) / 1000)} s):`);
  for (const item of items.filter((i) => i.llm)) {
    const s = (llm[item.id] ?? []).map((x) => `${x.categoryName} [${x.evidence}] ${x.note}`).join(" | ") || "no suggestion";
    console.log(`${item.payee.slice(0, 28).padEnd(28)} ${s}`);
  }
}
