import type { ComponentType } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "@/App";
import { SpendingProvider } from "@/pages/SpendingPage";
import { ScrapeRunProvider } from "@/components/ScrapeRunProvider";

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

/** *Page.tsx files with no page component to render alone. This list may only shrink. */
const NEEDS_APP_CONTEXT: Record<string, string> = {
  "SpendingPage.tsx": "exports SpendingProvider (the shared data), not a page",
};

/** No-op values for the props pages ask for. A new page prop that is missing here fails the test. */
const NOOP = () => {};
const PAGE_PROPS: Record<string, unknown> = {
  navigate: NOOP,
  onLeft: NOOP,
  openList: NOOP,
  openInbox: NOOP,
  openHistory: NOOP,
  view: "main",
  setView: NOOP,
};

const modules = import.meta.glob<Record<string, unknown>>("./*Page.tsx", { eager: true });
const pageComponents = (mod: Record<string, unknown>) =>
  Object.entries(mod).filter(([name, value]) => name.endsWith("Page") && typeof value === "function") as Array<[string, ComponentType<Record<string, unknown>>]>;

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

describe("offline smoke test: every page file", () => {
  it("each *Page.tsx has a page to render, or is listed in NEEDS_APP_CONTEXT", () => {
    const problems: string[] = [];
    for (const [path, mod] of Object.entries(modules)) {
      const file = path.replace("./", "");
      const count = pageComponents(mod).length;
      if (count === 0 && !(file in NEEDS_APP_CONTEXT)) problems.push(`${file}: no exported *Page component. Fix the file, or list it in NEEDS_APP_CONTEXT with a reason.`);
      if (count > 0 && file in NEEDS_APP_CONTEXT) problems.push(`${file}: it can be rendered now. Remove it from NEEDS_APP_CONTEXT.`);
    }
    for (const file of Object.keys(NEEDS_APP_CONTEXT)) {
      if (!Object.keys(modules).includes(`./${file}`)) problems.push(`${file}: the file is gone. Remove it from NEEDS_APP_CONTEXT.`);
    }
    expect(problems).toEqual([]);
  });

  const cases = Object.values(modules).flatMap(pageComponents);
  expect(cases.length).toBeGreaterThan(8);
  it.each(cases.map(([name, Component]) => [name, Component] as const))("%s survives a server that always fails", async (name, Component) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let failure = "";
    try {
      const view = render(
        <SpendingProvider>
          <ScrapeRunProvider>
            <Component {...PAGE_PROPS} />
          </ScrapeRunProvider>
        </SpendingProvider>
      );
      await settle();
      if (!view.container.textContent?.trim()) throw new Error("the page rendered no text");
      if (errorSpy.mock.calls.length) throw new Error(`console.error: ${errorSpy.mock.calls[0].map(String).join(" ").slice(0, 300)}`);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    } finally {
      errorSpy.mockRestore();
    }
    if (name in KNOWN_FAILING) expect(failure, `${name} now passes: remove it from KNOWN_FAILING`).not.toBe("");
    else expect(failure, `${name} crashed offline`).toBe("");
  });
});
