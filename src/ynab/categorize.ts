/**
 * Category suggestions for uncategorized YNAB transactions.
 * Pure logic only: memo parsing, history and card-sector evidence, LLM prompt and answer checks.
 * The I/O (YNAB, Serper web search, opencode) is in categorize-service.ts.
 */

export interface YnabTransaction {
  id: string;
  date: string;
  amount: number;
  memo: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  account_id: string;
  account_name: string;
  transfer_account_id: string | null;
  /** Set by YNAB for imported transactions (bank or this repo); null when entered by hand. */
  import_id?: string | null;
  cleared?: "cleared" | "uncleared" | "reconciled";
  deleted: boolean;
  subtransactions?: unknown[];
}

export interface CategoryOption {
  id: string;
  name: string;
  group: string;
}

export type Evidence = "history" | "sector" | "name" | "memo" | "web";

export interface Suggestion {
  categoryId: string;
  categoryName: string;
  evidence: Evidence;
  note: string;
  source?: string;
  /** History only: the share of past uses (0-1). Bulk accept needs 0.8 agreement and 3 uses. */
  share?: number;
  /** History only: number of prior transactions used to make this suggestion. */
  sampleSize?: number;
}

/** person = transfer to or from a named account holder; such names never leave this computer. */
export type ItemKind = "person" | "cash" | "other";

export interface CategorizeItem {
  id: string;
  date: string;
  amount: number;
  payee: string;
  account: string;
  bankText: string;
  handNote: string;
  merchant: string;
  sector: string;
  kind: ItemKind;
  suggestions: Suggestion[];
}

const BANK_TEXT_KEYS = ["bankMemo", "notes", "Secret Text"];
const YNAB_AUTO_MEMO = "Entered automatically by YNAB";

/**
 * An older importer wrote memos as JavaScript object text, not JSON: `{ chargeDate: '…', notes: '…' }`.
 * Reads its quoted string fields; returns null when there are none.
 */
function readObjectLiteral(text: string): Record<string, string> | null {
  const fields: Record<string, string> = {};
  for (const [, rawKey, value] of text.matchAll(/([A-Za-z]+|'[^']*'|"[^"]*")\s*:\s*'([^']*)'/g)) {
    fields[rawKey.replace(/^['"]|['"]$/g, "")] = value;
  }
  return Object.keys(fields).length ? fields : null;
}

/** Bank text, card sector, and any memo typed by hand. Older importers used "notes" or "Secret Text". */
export function readMemo(memo: string | null): { bankText: string; sector: string; handNote: string } {
  const text = memo?.trim() ?? "";
  if (!text) return { bankText: "", sector: "", handNote: "" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.startsWith("{") ? readObjectLiteral(text) : null;
    if (!parsed) return { bankText: "", sector: "", handNote: text.startsWith(YNAB_AUTO_MEMO) ? "" : text };
  }
  if (!parsed || typeof parsed !== "object") return { bankText: "", sector: "", handNote: "" };
  const fields = parsed as Record<string, unknown>;
  const bankText = BANK_TEXT_KEYS.map((k) => fields[k]).find((v) => typeof v === "string") as
    | string
    | undefined;
  return {
    bankText: bankText?.trim() ?? "",
    sector: typeof fields.category === "string" ? fields.category.trim() : "",
    handNote: "",
  };
}

// "העברה אל:" (one-off out), "העברה ל:" (standing order out), "העברה מאת:" (in), then name and bank-branch-account.
const TRANSFER_PATTERN = /^העברה (אל|ל|מאת):\s*(.+?)\s+(\d{2})-(\d{3})-(\d+)/;
const CARD_MERCHANT_PATTERN = /בכרטיס המסתיים ב-\d{4} ב-(.+)$/;
const CASH_PATTERN = /^נמשך מכרטיס/;

/**
 * What the bank text says about the other side: a named person (with their account), a cash machine,
 * or a card merchant. The account has leading zeros removed: the bank writes the same account as
 * "00479415" in one place and "000479415" in another.
 */
export function parseBankText(text: string): {
  counterparty: string;
  account: string;
  merchant: string;
  cash: boolean;
} {
  const transfer = text.match(TRANSFER_PATTERN);
  const merchant = text.match(CARD_MERCHANT_PATTERN);
  return {
    counterparty: transfer?.[2].trim() ?? "",
    account: transfer
      ? `${transfer[1] === "מאת" ? "in" : "out"} ${transfer[3]}-${transfer[4]}-${transfer[5].replace(/^0+/, "")}`
      : "",
    merchant: merchant?.[1].trim() ?? "",
    cash: CASH_PATTERN.test(text),
  };
}

/**
 * Lowercase words with punctuation, numbers, and per-charge reference codes removed, so
 * "AMAZON MKTPL 5X3QQ2A" and "AMAZON MKTPL 5R1AS4I" give the same key.
 */
export function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((word) => word && !/\d/.test(word))
    .join(" ");
}

/**
 * What identifies who the money went to. Generic bank payees ("הע. אינטרנט") hide the real
 * counterparty in the bank text. For a transfer, the account and direction win, because the bank
 * writes the same person's name in different orders.
 */
export function identityKey(txn: Pick<YnabTransaction, "payee_name" | "memo">): string {
  const { bankText } = readMemo(txn.memo);
  const { account, merchant } = parseBankText(bankText);
  if (account) return `account ${account}`;
  return normalizeKey(merchant || txn.payee_name || "");
}

/** YNAB marks some uncategorized transactions with its internal "Uncategorized" category. */
export function isUncategorized(txn: Pick<YnabTransaction, "category_id" | "category_name">): boolean {
  return !txn.category_id || txn.category_name === "Uncategorized";
}

/** One categorized past transaction, used as evidence. */
export interface PastUse {
  id: string;
  categoryId: string;
  amount: number;
}

export type HistoryIndex = Map<string, PastUse[]>;

function add(index: HistoryIndex, key: string, use: PastUse): void {
  if (!key) return;
  const list = index.get(key);
  if (list) list.push(use);
  else index.set(key, [use]);
}

/** Words of a person's name, sorted, for order-free matching. One-letter words are dropped. */
export function nameWords(name: string): string[] {
  return [...new Set(normalizeKey(name).split(" ").filter((w) => w.length > 1))].sort();
}

export interface Indexes {
  byKey: HistoryIndex;
  bySector: HistoryIndex;
  /** Transfer counterparties: their name words and past uses. */
  byName: Array<{ words: string[]; uses: PastUse[] }>;
}

/** Past categorized uses per payee identity, per card sector, and per transfer name. */
export function buildIndexes(history: YnabTransaction[]): Indexes {
  const byKey: HistoryIndex = new Map();
  const bySector: HistoryIndex = new Map();
  const names: HistoryIndex = new Map();
  for (const txn of history) {
    const categoryId = txn.category_id;
    if (!categoryId || txn.deleted || txn.transfer_account_id || isUncategorized(txn)) continue;
    if (txn.subtransactions?.length) continue;
    const use = { id: txn.id, categoryId, amount: txn.amount };
    const { bankText, sector } = readMemo(txn.memo);
    add(byKey, identityKey(txn), use);
    add(bySector, normalizeKey(sector), use);
    add(names, nameWords(parseBankText(bankText).counterparty).join(" "), use);
  }
  const byName = [...names.entries()].map(([key, uses]) => ({ words: key.split(" "), uses }));
  return { byKey, bySector, byName };
}

const MIN_NAME_WORDS = 2;

/** True when every word of the shorter name is in the longer one ("חיים ורשלייסר" in "ורשלייסר חיים דב"). */
export function sameName(a: string[], b: string[]): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= MIN_NAME_WORDS && shorter.every((w) => longer.includes(w));
}

/**
 * Past uses for one transaction. A transfer matches by account and also by name in any word order,
 * because a joint account has 2 names and a person can have 2 accounts. `match` says which matched.
 */
export function findUses(
  txn: Pick<YnabTransaction, "payee_name" | "memo">,
  indexes: Indexes
): { uses: PastUse[]; match: string } {
  const byAccount = indexes.byKey.get(identityKey(txn)) ?? [];
  const { counterparty, account } = parseBankText(readMemo(txn.memo).bankText);
  if (!account) return { uses: byAccount, match: "" };

  const words = nameWords(counterparty);
  const byName = indexes.byName.filter((n) => sameName(words, n.words)).flatMap((n) => n.uses);
  const accountIds = new Set(byAccount.map((u) => u.id));
  const nameIds = new Set(byName.map((u) => u.id));
  const uses = [...byAccount, ...byName.filter((u) => !accountIds.has(u.id))];
  if (!uses.length) return { uses, match: "" };

  let match = "same account or name";
  if (uses.every((u) => accountIds.has(u.id) && nameIds.has(u.id))) match = "same account and name";
  else if (nameIds.size === 0) match = "same account, different name";
  else if (accountIds.size === 0) match = "same name, different account";
  return { uses, match };
}

const SINGLE_SHARE = 0.8;
const OPTION_SHARE = 0.2;
const SECTOR_SHARE = 0.7;
const SECTOR_MIN = 3;

function countBy(uses: PastUse[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const u of uses) counts.set(u.categoryId, (counts.get(u.categoryId) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function formatShekels(milliunits: number): string {
  return `₪${(Math.abs(milliunits) / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * One suggestion when one category has at least 80% of the history.
 * More than one only when the history itself is split: each option needs 20% and 2 uses.
 * Split options are ranked by how many past uses had exactly this amount (compared locally only).
 */
export function historySuggestions(
  uses: PastUse[],
  name: string,
  categories: Map<string, CategoryOption>,
  amount = 0,
  match = ""
): Suggestion[] {
  if (!uses.length) return [];
  const entries = countBy(uses);
  const total = uses.length;
  const chosen =
    entries[0][1] / total >= SINGLE_SHARE
      ? [entries[0]]
      : entries.filter(([, n]) => n >= 2 && n / total >= OPTION_SHARE);

  const sameAmount = (id: string) =>
    uses.filter((u) => u.categoryId === id && Math.abs(u.amount) === Math.abs(amount)).length;
  if (chosen.length > 1) chosen.sort((a, b) => sameAmount(b[0]) - sameAmount(a[0]) || b[1] - a[1]);

  const who = match ? `"${name}" (${match})` : `"${name}"`;
  return chosen.flatMap(([id, n]) => {
    const category = categories.get(id);
    if (!category) return [];
    const same = chosen.length > 1 && amount ? sameAmount(id) : 0;
    const amountNote = same ? ` ${same} of them had the same amount, ${formatShekels(amount)}.` : "";
    return [
      {
        categoryId: id,
        categoryName: category.name,
        evidence: "history" as const,
        note: `You put ${who} in ${category.name} ${n} of ${total} time${total === 1 ? "" : "s"}.${amountNote}`,
        share: n / total,
        sampleSize: total,
      },
    ];
  });
}

export function sectorSuggestion(
  uses: PastUse[] | undefined,
  sector: string,
  categories: Map<string, CategoryOption>
): Suggestion[] {
  if (!uses?.length) return [];
  const [id, n] = countBy(uses)[0];
  const total = uses.length;
  const category = categories.get(id);
  if (!category || total < SECTOR_MIN || n / total < SECTOR_SHARE) return [];
  return [
    {
      categoryId: id,
      categoryName: category.name,
      evidence: "sector",
      note: `The card company lists this as "${sector}". You put that sector in ${category.name} ${n} of ${total} times.`,
    },
  ];
}

export function buildItems(
  uncategorized: YnabTransaction[],
  history: YnabTransaction[],
  categoryList: CategoryOption[],
  rejected: Record<string, string[]> = {}
): CategorizeItem[] {
  const categories = new Map(categoryList.map((c) => [c.id, c]));
  const indexes = buildIndexes(history);

  return uncategorized
    .filter((t) => !t.deleted && !t.transfer_account_id && !t.subtransactions?.length && isUncategorized(t))
    .map((txn) => {
      const { bankText, sector, handNote } = readMemo(txn.memo);
      const { counterparty, merchant, cash } = parseBankText(bankText);
      const payee = txn.payee_name ?? "";
      const name = counterparty || merchant || payee;
      const { uses, match } = findUses(txn, indexes);
      const fromHistory = historySuggestions(uses, name, categories, txn.amount, match);
      const suggestions = fromHistory.length
        ? fromHistory
        : sectorSuggestion(indexes.bySector.get(normalizeKey(sector)), sector, categories);
      const blocked = new Set(rejected[txn.id] ?? []);
      return {
        id: txn.id,
        date: txn.date,
        amount: txn.amount,
        payee,
        account: txn.account_name,
        bankText,
        handNote,
        merchant,
        sector,
        kind: counterparty ? "person" : cash ? "cash" : "other",
        suggestions: suggestions.filter((s) => !blocked.has(s.categoryId)),
      } satisfies CategorizeItem;
    });
}

/** Only these items go to the LLM: no evidence yet, and no private name or cash machine. */
export function needsLlm(item: CategorizeItem): boolean {
  return item.suggestions.length === 0 && item.kind === "other" && Boolean(item.payee || item.merchant);
}

/** Card, account, and reference numbers (any word of 5+ characters with a digit) never go to the LLM. */
export function scrubDigits(text: string): string {
  return text
    .split(/\s+/)
    .filter((word) => !(word.length >= 5 && /\d/.test(word)))
    .join(" ")
    .trim();
}

/** Web search results for one payee: short text for the LLM, and the top link to show the user. */
export interface SearchHit {
  text: string;
  url: string;
}

export function buildLlmPrompt(
  items: CategorizeItem[],
  categories: CategoryOption[],
  search: Map<string, SearchHit>
): string {
  const categoryLines = categories.map((c, i) => `${i + 1}. ${c.group} / ${c.name}`).join("\n");
  const itemLines = items
    .map((item, i) => {
      const fields: Record<string, string> = { n: String(i + 1), payee: scrubDigits(item.payee) };
      if (item.merchant) fields.merchant = scrubDigits(item.merchant);
      if (item.sector) fields.card_sector = item.sector;
      if (item.handNote) fields.note = scrubDigits(item.handNote);
      const hit = search.get(item.id);
      if (hit) fields.web_search = hit.text.slice(0, 700);
      return JSON.stringify(fields);
    })
    .join("\n");

  return `You categorize Israeli bank and credit card transactions into a household budget.
Do not use any tools. Do not read or write files. Do not run commands. Do not fetch web pages. Answer from the text below only.

Categories (number. group / name):
${categoryLines}

Transactions (one JSON object per line; text is often Hebrew):
${itemLines}

Rules:
- Suggest a category only when the evidence makes it clear: the merchant name says what the business is, the card_sector says it, the note says it, or the web_search results describe the business.
- If you are not sure, return no suggestions for that transaction. A wrong suggestion is worse than none.
- Return 2 suggestions only when the business clearly fits 2 categories. Never more than 2.
- "evidence" is one of: "name", "sector", "memo", "web". Use "web" only when the web_search results are the reason. Use "memo" when the note is the reason.
- "reason" is one short English sentence that names the specific evidence, e.g. "Super-Pharm is a pharmacy chain."
- web_search results can be about a different business with a similar name. Use them only when they clearly match this payee.

Reply with only a JSON array, no prose, no code fence:
[{"n": 1, "suggestions": [{"category": 7, "evidence": "name", "reason": "..."}]}]`;
}

const LLM_EVIDENCE: Evidence[] = ["name", "sector", "memo", "web"];

/** Keep only well-formed suggestions that point at a real category and name their evidence. */
export function parseLlmAnswer(
  text: string,
  items: CategorizeItem[],
  categories: CategoryOption[],
  search: Map<string, SearchHit>
): Map<string, Suggestion[]> {
  const result = new Map<string, Suggestion[]>();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return result;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return result;
  }
  if (!Array.isArray(parsed)) return result;

  for (const entry of parsed) {
    const item = items[Number(entry?.n) - 1];
    if (!item || !Array.isArray(entry.suggestions)) continue;
    const valid: Suggestion[] = [];
    for (const s of entry.suggestions.slice(0, 2)) {
      const category = categories[Number(s?.category) - 1];
      const evidence = s?.evidence as Evidence;
      const reason = typeof s?.reason === "string" ? s.reason.trim().slice(0, 300) : "";
      if (!category || !reason || !LLM_EVIDENCE.includes(evidence)) continue;
      if (valid.some((v) => v.categoryId === category.id)) continue;
      const hit = search.get(item.id);
      if (evidence === "web" && !hit) continue;
      if (evidence === "memo" && !item.handNote) continue;
      if (evidence === "sector" && !item.sector) continue;
      valid.push({
        categoryId: category.id,
        categoryName: category.name,
        evidence,
        note: reason,
        ...(evidence === "web" && hit ? { source: hit.url } : {}),
      });
    }
    if (valid.length) result.set(item.id, valid);
  }
  return result;
}
