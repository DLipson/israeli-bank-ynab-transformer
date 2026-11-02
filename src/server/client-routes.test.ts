import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import accountsRouter from "./routes/accounts.js";
import scrapeRouter from "./routes/scrape.js";
import ynabRouter from "./routes/ynab.js";
import historyRouter from "./routes/history.js";
import categorizeRouter from "./routes/categorize.js";
import spendingRouter from "./routes/spending.js";

// Keep in step with the app.use(...) lines in index.ts.
const MOUNTS: Array<[string, { stack: unknown[] }]> = [
  ["/api/accounts", accountsRouter],
  ["/api/ynab", ynabRouter],
  ["/api/history", historyRouter],
  ["/api/categorize", categorizeRouter],
  ["/api/spending", spendingRouter],
  ["/api", scrapeRouter],
  ["/api/health", { stack: [{ route: { path: "/", methods: { get: true } } }] }],
];

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
}

function routeTable(): Array<{ method: string; pattern: RegExp }> {
  const table: Array<{ method: string; pattern: RegExp }> = [];
  for (const [prefix, router] of MOUNTS) {
    for (const layer of router.stack as Layer[]) {
      if (!layer.route) continue;
      const path = (prefix + (layer.route.path === "/" ? "" : layer.route.path)).replace(/:[^/]+/g, "[^/]+");
      for (const method of Object.keys(layer.route.methods)) table.push({ method: method.toUpperCase(), pattern: new RegExp(`^${path}/?$`) });
    }
  }
  return table;
}

const clientPath = resolve(fileURLToPath(import.meta.url), "../../../gui/src/api/client.ts");

function dummy(): unknown[] {
  // Strings, numbers, objects and arrays: enough for every client function.
  return ["x", "x", "x", 1, {}, []];
}

describe("GUI client routes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("every request of the GUI client matches a mounted server route", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string }) => {
      calls.push({ method: (init?.method ?? "GET").toUpperCase(), url: String(url) });
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal(
      "EventSource",
      class {
        constructor(url: string) {
          calls.push({ method: "GET", url });
        }
        close() {}
      }
    );

    const client = (await import(/* @vite-ignore */ clientPath)) as Record<string, unknown>;
    for (const fn of Object.values(client)) {
      if (typeof fn !== "function") continue;
      try {
        await (fn as (...args: unknown[]) => unknown)(...dummy());
      } catch {
        // Code after the request may need a browser (document, Blob). The request is already recorded.
      }
    }

    expect(calls.length, "too few requests recorded: the test itself is broken").toBeGreaterThanOrEqual(20);
    const table = routeTable();
    const unmatched = calls
      .filter((c) => !table.some((r) => r.method === c.method && r.pattern.test(c.url.split("?")[0])))
      .map((c) => `${c.method} ${c.url}`);
    expect(unmatched).toEqual([]);
  });
});
