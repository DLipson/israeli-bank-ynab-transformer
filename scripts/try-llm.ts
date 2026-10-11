// Manual check of the LLM step with made-up payees. Sends no personal data.
// Usage: npx tsx scripts/try-llm.ts
import { buildItems, buildLlmPrompt, parseLlmAnswer, type CategoryOption, type SearchHit } from "../src/ynab/categorize.js";
import { runOpencode } from "../src/ynab/categorize-service.js";

const categories: CategoryOption[] = [
  { id: "groc", name: "Groceries", group: "Food" },
  { id: "pharm", name: "Pharmacy", group: "Health" },
  { id: "fuel", name: "Fuel", group: "Car" },
  { id: "phone", name: "Phone", group: "Bills" },
];
const base = { date: "2026-10-01", amount: -1, category_id: null, category_name: null, account_id: "acc-card", account_name: "Card", transfer_account_id: null, deleted: false };
const items = buildItems(
  [
    { ...base, id: "a", payee_name: "סופר פארם בית שמש", memo: null },
    { ...base, id: "b", payee_name: "דלק קמעונאות גוש עציון", memo: null },
    { ...base, id: "c", payee_name: "י.ש. אחזקות 2002", memo: null },
  ],
  [],
  categories
);
const search = new Map<string, SearchHit>();
const started = Date.now();
const answer = await runOpencode(buildLlmPrompt(items, categories, search));
console.log(`answer in ${Math.round((Date.now() - started) / 1000)} s:\n${answer}\n`);
console.log(Object.fromEntries(parseLlmAnswer(answer, items, categories, search)));
