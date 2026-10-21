import { afterEach, describe, expect, it, vi } from "vitest";
import { buildYnabTransactions, getRowSource } from "./import-service.js";
import type { YnabRow } from "../transformer.js";

function row(source: string, overrides: Partial<YnabRow> = {}): YnabRow {
  return {
    date: "2026-10-01",
    payee: "Shop",
    memo: JSON.stringify({ source }),
    outflow: "12.50",
    inflow: "",
    ...overrides,
  };
}

describe("getRowSource", () => {
  it("reads source from JSON memo and falls back to unknown", () => {
    expect(getRowSource(row("Max - 1234"))).toBe("Max - 1234");
    expect(getRowSource({ ...row("x"), memo: "" })).toBe("unknown");
  });
});

describe("buildYnabTransactions", () => {
  const mappings = { "Max - 1234": "acc-max", "Leumi - 999": "acc-leumi", "Isracard - 5": "" };

  it("routes rows to mapped accounts in milliunits and reports unmapped sources", () => {
    const { transactions, unmapped } = buildYnabTransactions(
      [
        row("Max - 1234"),
        row("Leumi - 999", { outflow: "", inflow: "100" }),
        row("Isracard - 5"),
        row("Other"),
      ],
      mappings
    );

    expect(transactions.map((t) => [t.account_id, t.amount])).toEqual([
      ["acc-max", -12500],
      ["acc-leumi", 100000],
    ]);
    expect(transactions[0]).toMatchObject({ cleared: "cleared", approved: false });
    expect(unmapped.sort()).toEqual(["Isracard - 5", "Other"]);
  });

  it("numbers identical transactions per account so import_ids stay unique and stable", () => {
    const { transactions } = buildYnabTransactions(
      [row("Max - 1234"), row("Max - 1234"), row("Leumi - 999")],
      mappings
    );

    expect(transactions.map((t) => t.import_id)).toEqual([
      "YNAB:-12500:2026-10-01:1",
      "YNAB:-12500:2026-10-01:2",
      "YNAB:-12500:2026-10-01:1",
    ]);
  });

  it("truncates payee and memo to YNAB limits", () => {
    const { transactions } = buildYnabTransactions(
      [row("Max - 1234", { payee: "p".repeat(300) })],
      mappings
    );
    expect(transactions[0].payee_name).toHaveLength(200);
  });
});

describe("ynabRequest sharing", () => {
  const ok = () => new Response(JSON.stringify({ data: { n: 1 } }), { status: 200 });

  async function load(respond: () => Response = ok) {
    vi.resetModules();
    const fetchMock = vi.fn(async () => respond());
    vi.stubGlobal("fetch", fetchMock);
    const { ynabRequest } = await import("./import-service.js");
    return { fetchMock, ynabRequest };
  }

  afterEach(() => vi.unstubAllGlobals());

  it("shares concurrent GETs of the same path", async () => {
    const { fetchMock, ynabRequest } = await load();
    await Promise.all([ynabRequest("t", "/budgets"), ynabRequest("t", "/budgets")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads again after a write", async () => {
    const { fetchMock, ynabRequest } = await load();
    await ynabRequest("t", "/budgets");
    await ynabRequest("t", "/budgets", { method: "POST", body: "{}" });
    await ynabRequest("t", "/budgets");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reads again when fresh is true", async () => {
    const { fetchMock, ynabRequest } = await load();
    await ynabRequest("t", "/budgets");
    await ynabRequest("t", "/budgets", { fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as unknown[])[1]).not.toHaveProperty("fresh");
  });

  it("does not reuse a failed GET", async () => {
    const { fetchMock, ynabRequest } = await load(() => new Response("{}", { status: 500 }));
    await expect(ynabRequest("t", "/budgets")).rejects.toThrow();
    await expect(ynabRequest("t", "/budgets")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
