import { describe, expect, it } from "vitest";
import {
  buildIndexes,
  buildItems,
  findUses,
  buildLlmPrompt,
  historySuggestions,
  identityKey,
  needsLlm,
  parseBankText,
  parseLlmAnswer,
  readMemo,
  scrubDigits,
  type CategoryOption,
  type PastUse,
  type SearchHit,
  type YnabTransaction,
} from "./categorize.js";
import { summarizeSerper } from "./categorize-service.js";
import { mergeDelta } from "./transaction-cache.js";

const categories: CategoryOption[] = [
  { id: "groc", name: "Groceries", group: "Food" },
  { id: "health", name: "Health", group: "Bills" },
  { id: "therapy", name: "Therapy", group: "Bills" },
  { id: "house", name: "Household", group: "Home" },
];
const byId = new Map(categories.map((c) => [c.id, c]));

let nextId = 0;
function txn(overrides: Partial<YnabTransaction> = {}): YnabTransaction {
  nextId += 1;
  return {
    id: `t${nextId}`,
    date: "2026-10-01",
    amount: -10000,
    memo: null,
    payee_name: "Shop",
    category_id: null,
    category_name: null,
    account_name: "Main Account",
    transfer_account_id: null,
    deleted: false,
    ...overrides,
  };
}

const TRANSFER_TEXT = "העברה אל: ELISHEVA SIMON 12-446-000102520 תשלום";

describe("readMemo", () => {
  it("reads bank text from all 3 field names, the card sector, and hand-typed notes", () => {
    expect(readMemo(JSON.stringify({ bankMemo: "a", category: "מזון ומשקאות" }))).toEqual({
      bankText: "a",
      sector: "מזון ומשקאות",
      handNote: "",
    });
    expect(readMemo(JSON.stringify({ notes: "b" })).bankText).toBe("b");
    expect(readMemo(JSON.stringify({ "Secret Text": "c" })).bankText).toBe("c");
    expect(readMemo("car cleaning").handNote).toBe("car cleaning");
    expect(readMemo("Entered automatically by YNAB").handNote).toBe("");
    expect(readMemo(null).bankText).toBe("");
  });
});

describe("parseBankText", () => {
  it("finds the transfer counterparty, the card merchant, and cash withdrawals", () => {
    expect(parseBankText(TRANSFER_TEXT).counterparty).toBe("ELISHEVA SIMON");
    expect(parseBankText("מתאריך 07/07/25  20:07 בכרטיס המסתיים ב-6347 ב-דלק קמעונאות").merchant).toBe(
      "דלק קמעונאות"
    );
    expect(parseBankText("נמשך מכרטיס המסתיים ב-8400 במכשיר בינלאומי").cash).toBe(true);
  });

  it("uses the transfer account and direction, not the generic bank payee, as identity", () => {
    const a = identityKey({ payee_name: "הע. אינטרנט", memo: JSON.stringify({ bankMemo: TRANSFER_TEXT }) });
    const b = identityKey({ payee_name: "העברה דיגיטל", memo: JSON.stringify({ "Secret Text": TRANSFER_TEXT }) });
    expect(a).toBe(b);
    expect(a).toBe("account out 12-446-102520");
  });

  it("matches a standing order to a one-off transfer to the same account despite name order and zeros", () => {
    const oneOff = identityKey({
      payee_name: "העברה דיגיטל",
      memo: JSON.stringify({ bankMemo: "העברה אל: חיים ורשלייסר 12-695-000479415 תשלום" }),
    });
    const standingOrder = identityKey({
      payee_name: "הוראת קבע",
      memo: "{   chargeDate: '2025-11-09',   notes: 'העברה ל: ורשלייסר חיים 12-695-00479415 תאריך סיום: 08.10.2026 תשלום',   source: '674-11670/59', }",
    });
    const incoming = identityKey({
      payee_name: "בנק הפועלים",
      memo: JSON.stringify({ bankMemo: "העברה מאת: ורשלייסר חיים דב 12-695-000479415 LOAN" }),
    });
    expect(standingOrder).toBe(oneOff);
    expect(incoming).not.toBe(oneOff);
  });

  it("reads the older object-text memo format", () => {
    expect(readMemo("{ chargeDate: '2025-11-09', notes: 'העברה ל: X 12-695-1 תשלום' }").bankText).toBe(
      "העברה ל: X 12-695-1 תשלום"
    );
  });

  it("ignores per-charge reference codes, so the same merchant matches", () => {
    expect(identityKey({ payee_name: "AMAZON MKTPL 5X3QQ2A", memo: null })).toBe("amazon mktpl");
    expect(identityKey({ payee_name: "SPOTIFY P476C3A00B", memo: null })).toBe("spotify");
  });
});

function uses(spec: Array<[string, number, number?]>): PastUse[] {
  return spec.flatMap(([categoryId, n, amount = -100000], i) =>
    Array.from({ length: n }, (_, j) => ({ id: `${categoryId}-${i}-${j}`, categoryId, amount }))
  );
}

describe("historySuggestions", () => {
  it("gives one suggestion when one category has 80% of the history", () => {
    const result = historySuggestions(uses([["groc", 9], ["house", 1]]), "Shufersal", byId);
    expect(result.map((s) => s.categoryId)).toEqual(["groc"]);
    expect(result[0].note).toBe('You put "Shufersal" in Groceries 9 of 10 times.');
    expect(result[0].share).toBe(0.9);
  });

  it("gives each option when the history is split, and drops one-off categories", () => {
    const result = historySuggestions(uses([["groc", 6], ["house", 4], ["health", 1]]), "X", byId);
    expect(result.map((s) => s.categoryId)).toEqual(["groc", "house"]);
  });

  it("ranks split options by past uses with the same amount, and says so", () => {
    const result = historySuggestions(
      uses([["therapy", 6, -450000], ["house", 4, -2000000]]),
      "חיים ורשלייסר",
      byId,
      -2000000,
      "same account and name"
    );
    expect(result.map((s) => s.categoryId)).toEqual(["house", "therapy"]);
    expect(result[0].note).toBe(
      'You put "חיים ורשלייסר" (same account and name) in Household 4 of 10 times. 4 of them had the same amount, ₪2,000.'
    );
    expect(result[1].note).not.toContain("same amount");
  });
});

describe("findUses for transfers", () => {
  const out = (name: string, account: string) =>
    JSON.stringify({ bankMemo: `העברה אל: ${name} ${account} תשלום` });
  const history = [
    txn({ id: "h1", memo: out("חיים ורשלייסר", "12-695-000479415"), category_id: "therapy", category_name: "Therapy" }),
    txn({ id: "h2", memo: out("ורשלייסר חיים דב", "10-111-000000222"), category_id: "therapy", category_name: "Therapy" }),
    txn({ id: "h3", memo: out("יעל כהן", "12-695-000479415"), category_id: "house", category_name: "Household" }),
    txn({ id: "h4", memo: out("PAYMENT", "20-111-000000333"), category_id: "groc", category_name: "Groceries" }),
  ];
  const indexes = buildIndexes(history);

  it("matches by account and by name in any word order", () => {
    const { uses: found, match } = findUses({ payee_name: "x", memo: out("חיים ורשלייסר", "12-695-479415") }, indexes);
    expect(found.map((u) => u.id).sort()).toEqual(["h1", "h2", "h3"]);
    expect(match).toBe("same account or name");
  });

  it("labels a name-only match, and ignores one-word names", () => {
    expect(findUses({ payee_name: "x", memo: out("ורשלייסר חיים", "99-999-1") }, indexes)).toMatchObject({
      match: "same name, different account",
    });
    expect(findUses({ payee_name: "x", memo: out("PAYMENT", "99-999-2") }, indexes).uses).toEqual([]);
  });
});

describe("buildItems", () => {
  const history = [
    txn({ payee_name: "הע. אינטרנט", memo: JSON.stringify({ "Secret Text": TRANSFER_TEXT }), category_id: "therapy", category_name: "Therapy" }),
    ...[1, 2, 3].map(() => txn({ payee_name: "Pharm", memo: JSON.stringify({ category: "רפואה ובתי מרקחת" }), category_id: "health", category_name: "Health" })),
  ];

  it("suggests from transfer history and from the card sector, and skips transfers and splits", () => {
    const uncategorized = [
      txn({ id: "person", payee_name: "העברה דיגיטל", memo: JSON.stringify({ bankMemo: TRANSFER_TEXT }) }),
      txn({ id: "sector", payee_name: "New pharmacy", memo: JSON.stringify({ category: "רפואה ובתי מרקחת" }) }),
      txn({ id: "unknown", payee_name: "Random shop" }),
      txn({ id: "transfer", transfer_account_id: "acc" }),
      txn({ id: "split", subtransactions: [{}] }),
      txn({ id: "ynab-uncat", payee_name: "Random shop 2", category_id: "u", category_name: "Uncategorized" }),
    ];
    const items = buildItems(uncategorized, history, categories);
    const byItem = new Map(items.map((i) => [i.id, i]));

    expect([...byItem.keys()]).toEqual(["person", "sector", "unknown", "ynab-uncat"]);
    expect(byItem.get("person")?.suggestions[0]).toMatchObject({ categoryId: "therapy", evidence: "history" });
    expect(byItem.get("person")?.kind).toBe("person");
    expect(byItem.get("sector")?.suggestions[0]).toMatchObject({ categoryId: "health", evidence: "sector" });
    expect(byItem.get("unknown")?.suggestions).toEqual([]);
  });

  it("drops rejected suggestions and never sends people or cash to the LLM", () => {
    const person = txn({ id: "p", memo: JSON.stringify({ bankMemo: TRANSFER_TEXT }) });
    const [item] = buildItems([person], history, categories, { p: ["therapy"] });
    expect(item.suggestions).toEqual([]);
    expect(needsLlm(item)).toBe(false);

    const [cash] = buildItems([txn({ memo: JSON.stringify({ bankMemo: "נמשך מכרטיס המסתיים ב-8400 במכשיר" }) })], [], categories);
    expect(needsLlm(cash)).toBe(false);
  });
});

describe("LLM prompt and answer", () => {
  const items = buildItems(
    [
      txn({ id: "a", payee_name: "סופר פארם 12345678" }),
      txn({ id: "b", payee_name: "חדאד טק", memo: "phone repair" }),
    ],
    [],
    categories
  );
  const search = new Map<string, SearchHit>([["a", { text: "Super-Pharm pharmacy chain", url: "https://x" }]]);

  it("removes long digit runs and never includes amounts", () => {
    expect(scrubDigits("סופר פארם 12345678")).toBe("סופר פארם");
    const prompt = buildLlmPrompt(items, categories, search);
    expect(prompt).not.toContain("12345678");
    expect(prompt).not.toContain("10000");
    expect(prompt).toContain("Super-Pharm pharmacy chain");
  });

  it("keeps only valid suggestions with real evidence", () => {
    const answer = `Here: [
      {"n": 1, "suggestions": [
        {"category": 2, "evidence": "web", "reason": "Super-Pharm is a pharmacy."},
        {"category": 2, "evidence": "name", "reason": "duplicate"},
        {"category": 99, "evidence": "name", "reason": "no such category"}
      ]},
      {"n": 2, "suggestions": [
        {"category": 4, "evidence": "web", "reason": "no search hit for this item"},
        {"category": 4, "evidence": "memo", "reason": "The note says phone repair."},
        {"category": 1, "evidence": "guess", "reason": "bad evidence"}
      ]}
    ]`;
    const result = parseLlmAnswer(answer, items, categories, search);
    expect(result.get("a")).toEqual([
      { categoryId: "health", categoryName: "Health", evidence: "web", note: "Super-Pharm is a pharmacy.", source: "https://x" },
    ]);
    expect(result.get("b")?.map((s) => [s.categoryId, s.evidence])).toEqual([["house", "memo"]]);
    expect(parseLlmAnswer("not json", items, categories, search).size).toBe(0);
  });
});

describe("summarizeSerper", () => {
  it("joins the knowledge panel, map listings, and results, and picks a link", () => {
    const hit = summarizeSerper({
      knowledgeGraph: { title: "חדאד טק", type: "Phone repair shop", website: "https://haddad.example" },
      places: [{ title: "חדאד טק", category: "Cell phone store", address: "Beit Shemesh" }],
      organic: [{ title: "Haddad Tech", link: "https://a.example", snippet: "Phone repairs" }],
    });
    expect(hit?.url).toBe("https://haddad.example");
    expect(hit?.text).toContain("Map listing: חדאד טק - Cell phone store - Beit Shemesh");
    expect(summarizeSerper({})).toBeNull();
  });
});

describe("mergeDelta", () => {
  it("replaces changed transactions, adds new ones, and removes deleted ones", () => {
    const a = txn({ id: "a", category_id: null });
    const b = txn({ id: "b" });
    const merged = mergeDelta([a, b], [
      { ...a, category_id: "groc" },
      { ...b, deleted: true },
      txn({ id: "c" }),
    ]);
    expect(merged.map((t) => [t.id, t.category_id])).toEqual([["a", "groc"], ["c", null]]);
  });
});
