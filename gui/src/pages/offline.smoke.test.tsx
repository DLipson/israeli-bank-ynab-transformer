import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "@/App";

// A failing server must never crash a page. Every API function rejects; nothing else is mocked.
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/api/client");
  const mocked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(actual)) {
    mocked[key] = typeof value === "function" ? vi.fn(() => Promise.reject(new Error("Server is offline"))) : value;
  }
  return mocked;
});

/** Pages that crash offline today: name -> error text. Remove a page from here when it is fixed. */
const KNOWN_FAILING: Record<string, string> = {};

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

describe("offline smoke test", () => {
  beforeEach(() => localStorage.clear());

  it("every page survives a server that always fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failures: Record<string, string> = {};

    // One entry per page: each top-level tab, then the Settings button.
    const open = async (name: string): Promise<string> => {
      if (name === "Settings") {
        fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      } else {
        const tab = screen.getAllByRole("tab").find((t) => (t.textContent ?? "").startsWith(name))!;
        fireEvent.mouseDown(tab, { button: 0 });
        await settle();
        return document.getElementById(tab.getAttribute("aria-controls") ?? "")?.textContent?.trim() ?? "";
      }
      await settle();
      return (screen.getAllByRole("tabpanel").find((p) => p.getAttribute("data-state") === "active")?.textContent ?? "").trim();
    };

    render(<App />);
    await settle();
    const names = [...screen.getAllByRole("tab").map((t) => (t.textContent ?? "").split(" ")[0]), "Settings"];
    expect(names.length).toBeGreaterThan(2);

    for (const name of names) {
      errorSpy.mockClear();
      try {
        const text = await open(name);
        if (!text) throw new Error("the page rendered no text");
        if (errorSpy.mock.calls.length) throw new Error(`console.error: ${errorSpy.mock.calls[0].map(String).join(" ").slice(0, 300)}`);
      } catch (e) {
        failures[name] = e instanceof Error ? e.message : String(e);
      }
    }
    errorSpy.mockRestore();

    const unexpected = Object.entries(failures).filter(([name]) => !(name in KNOWN_FAILING));
    expect(unexpected, "a page crashed offline").toEqual([]);
    const fixed = Object.keys(KNOWN_FAILING).filter((name) => !(name in failures));
    expect(fixed, "remove these from KNOWN_FAILING, they now pass").toEqual([]);
  }, 60_000);
});
