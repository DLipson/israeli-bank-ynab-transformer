import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureAppConfigDirExists, getAppConfigDir } from "../env.js";
import { loadYnabImportConfig, ynabRequest } from "./import-service.js";
import { SERPER_KEY_ENV_VAR } from "../windows-credential-manager.js";
import { getAllTransactions } from "./transaction-cache.js";
import {
  buildItems,
  buildLlmPrompt,
  needsLlm,
  parseLlmAnswer,
  scrubDigits,
  type CategorizeItem,
  type CategoryOption,
  type Suggestion,
  type SearchHit,
  type YnabTransaction,
} from "./categorize.js";

const LLM_MODEL = "opencode/big-pickle";
const LLM_TIMEOUT_MS = 5 * 60 * 1000;
// Internal YNAB groups that are not spending categories. "Inflow: Ready to Assign" stays.
const HIDDEN_GROUPS = new Set(["Credit Card Payments", "Hidden Categories"]);

function budgetId(): string {
  const id = loadYnabImportConfig().budgetId;
  if (!id) throw new Error("No YNAB budget selected. Choose one in the YNAB tab.");
  return id;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function fetchCategories(token: string): Promise<CategoryOption[]> {
  const data = await ynabRequest<{
    category_groups: Array<{
      name: string;
      hidden: boolean;
      deleted: boolean;
      categories: Array<{ id: string; name: string; hidden: boolean; deleted: boolean }>;
    }>;
  }>(token, `/budgets/${encodeURIComponent(budgetId())}/categories`);

  return data.category_groups
    .filter((g) => !g.hidden && !g.deleted && !HIDDEN_GROUPS.has(g.name))
    .flatMap((g) =>
      g.categories
        .filter((c) => !c.hidden && !c.deleted && c.name !== "Uncategorized")
        .map((c) => ({ id: c.id, name: c.name, group: g.name === "Internal Master Category" ? "Income" : g.name }))
    );
}

// --- Rejected suggestions, so they do not come back ---

function rejectionsPath(): string {
  return join(getAppConfigDir(), "categorize-rejections.json");
}

export function loadRejections(): Record<string, string[]> {
  const path = rejectionsPath();
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf-8")) as Record<string, string[]>) : {};
}

export function saveRejection(transactionId: string, categoryId: string): void {
  const rejections = loadRejections();
  rejections[transactionId] = [...new Set([...(rejections[transactionId] ?? []), categoryId])];
  ensureAppConfigDirExists();
  writeFileSync(rejectionsPath(), JSON.stringify(rejections, null, 2), "utf-8");
}

// --- Suggestions ---

// The LLM step needs the items and categories of the last list, so the client only sends ids.
let lastList: { items: Map<string, CategorizeItem>; categories: CategoryOption[] } | null = null;

// The last YNAB sync, kept in memory, so a change of days only filters again and makes no YNAB call.
let synced: { history: YnabTransaction[]; categories: CategoryOption[] } | null = null;

export async function getCategorizeList(
  token: string,
  days: number,
  sync: boolean
): Promise<{ categories: CategoryOption[]; items: Array<CategorizeItem & { llm: boolean }> }> {
  if (sync || !synced) {
    const [history, categories] = await Promise.all([getAllTransactions(token, budgetId()), fetchCategories(token)]);
    synced = { history, categories };
  }
  // buildItems keeps only the uncategorized transactions in the window as items.
  const { history, categories } = synced;
  const since = isoDaysAgo(days);
  const recent = history.filter((t) => t.date >= since);
  const items = buildItems(recent, history, categories, loadRejections()).sort((a, b) =>
    b.date.localeCompare(a.date)
  );
  lastList = { items: new Map(items.map((i) => [i.id, i])), categories };
  return { categories, items: items.map((i) => ({ ...i, llm: needsLlm(i) })) };
}

export async function setCategory(token: string, transactionId: string, categoryId: string | null): Promise<void> {
  await ynabRequest(token, `/budgets/${encodeURIComponent(budgetId())}/transactions`, {
    method: "PATCH",
    body: JSON.stringify({ transactions: [{ id: transactionId, category_id: categoryId }] }),
  });
  // Keep the in-memory copy current, so a change of days does not show it as uncategorized again.
  const txn = synced?.history.find((t) => t.id === transactionId);
  if (txn) {
    txn.category_id = categoryId;
    txn.category_name = synced?.categories.find((c) => c.id === categoryId)?.name ?? null;
  }
}

// --- Web search (Serper: Google results as JSON; NetFree allows google.serper.dev) ---

const SERPER_URL = "https://google.serper.dev/search";

interface SerperResponse {
  knowledgeGraph?: { title?: string; type?: string; description?: string; website?: string };
  places?: Array<{ title?: string; category?: string; address?: string }>;
  organic?: Array<{ title?: string; link?: string; snippet?: string }>;
}

/** Turn a Serper response into short text for the LLM, plus the top link for the user. */
export function summarizeSerper(data: SerperResponse): SearchHit | null {
  const lines: string[] = [];
  const kg = data.knowledgeGraph;
  if (kg?.title) lines.push(`Knowledge panel: ${[kg.title, kg.type, kg.description].filter(Boolean).join(" - ")}`);
  for (const place of (data.places ?? []).slice(0, 2)) {
    lines.push(`Map listing: ${[place.title, place.category, place.address].filter(Boolean).join(" - ")}`);
  }
  for (const result of (data.organic ?? []).slice(0, 4)) {
    lines.push(`Result: ${[result.title, result.snippet].filter(Boolean).join(" - ")}`);
  }
  const url = kg?.website ?? data.organic?.[0]?.link ?? "";
  return lines.length ? { text: lines.join("\n"), url } : null;
}

async function webSearch(apiKey: string, term: string): Promise<SearchHit | null> {
  const query = scrubDigits(term).trim();
  if (query.length < 2) return null;
  const response = await fetch(SERPER_URL, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, gl: "il", hl: "iw", num: 5 }),
  });
  if (!response.ok) throw new Error(`Serper search failed (${response.status}).`);
  const hit = summarizeSerper((await response.json()) as SerperResponse);
  return hit && { ...hit, url: hit.url || `https://www.google.com/search?q=${encodeURIComponent(query)}` };
}

async function searchHits(items: CategorizeItem[]): Promise<Map<string, SearchHit>> {
  const hits = new Map<string, SearchHit>();
  const apiKey = process.env[SERPER_KEY_ENV_VAR]?.trim();
  if (!apiKey) return hits;
  await Promise.all(
    items.map(async (item) => {
      const hit = await webSearch(apiKey, item.merchant || item.payee).catch(() => null);
      if (hit) hits.set(item.id, hit);
    })
  );
  return hits;
}

// --- opencode (Big Pickle) ---

/**
 * Runs the prompt through `opencode run` in an empty temp folder.
 * Big Pickle's free tier rejects a locked-down opencode config, so the model still has tools.
 * The prompt forbids them, the folder is empty, and any answer that used a tool is thrown away.
 */
export function runOpencode(prompt: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "ibyt-categorize-"));

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "opencode",
      // No shell, so the prompt passes as one argument. Attaching it with -f made runs 20x slower.
      ["run", prompt, "-m", LLM_MODEL, "--pure", "--format", "json"],
      // PWD: opencode picks its project folder from PWD, not from cwd.
      // stdin "ignore": with an open stdin pipe, opencode waits for more input before it starts.
      { cwd: dir, env: { ...process.env, PWD: dir }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    // The Chocolatey shim starts the real opencode as a child, so kill the whole process tree.
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      else child.kill();
    }, LLM_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start opencode: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      const texts: string[] = [];
      const tools: string[] = [];
      for (const line of stdout.split("\n")) {
        let event: { type?: string; part?: { type?: string; text?: string; tool?: string }; error?: { data?: { message?: string } } };
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === "error") return reject(new Error(`opencode: ${event.error?.data?.message ?? "unknown error"}`));
        if (event.part?.type === "text" && event.part.text) texts.push(event.part.text);
        if (event.part?.type === "tool") tools.push(event.part.tool ?? "unknown");
      }
      if (tools.length) return reject(new Error(`The model used tools (${tools.join(", ")}), so its answer was discarded.`));
      if (!texts.length) return reject(new Error(`opencode returned no answer (exit ${code}). ${stderr.slice(0, 300)}`));
      resolve(texts.join("\n"));
    });
  });
}

// Answers per transaction id, kept while the server runs, so changing the days does not ask again.
// An empty list means the model was asked and had no suggestion.
const llmAnswers = new Map<string, Suggestion[]>();

export async function getLlmSuggestions(ids: string[]): Promise<Record<string, Suggestion[]>> {
  if (!lastList) throw new Error("Load the list first.");
  const { categories } = lastList;
  const items = ids.map((id) => lastList?.items.get(id)).filter((i): i is CategorizeItem => Boolean(i && needsLlm(i)));
  const toAsk = items.filter((i) => !llmAnswers.has(i.id));

  if (toAsk.length) {
    const search = await searchHits(toAsk);
    const answer = await runOpencode(buildLlmPrompt(toAsk, categories, search));
    const found = parseLlmAnswer(answer, toAsk, categories, search);
    for (const item of toAsk) llmAnswers.set(item.id, found.get(item.id) ?? []);
  }

  const rejected = loadRejections();
  const result: Record<string, Suggestion[]> = {};
  for (const item of items) {
    const kept = (llmAnswers.get(item.id) ?? []).filter((s) => !(rejected[item.id] ?? []).includes(s.categoryId));
    if (kept.length) result[item.id] = kept;
  }
  return result;
}
