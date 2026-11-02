/**
 * exploreControls: a generic check of the inputs of a component.
 *
 * WHEN TO USE: every component that has inputs (select, checkbox, radio, text or number input)
 * must have one test like this:
 *
 *   it("keeps its controls independent", async () => {
 *     await exploreControls(<MyCard />);
 *   });
 *
 * It renders the component, finds every control, and tries each value of each control, then each
 * ordered pair of controls. After every step it checks these rules:
 *   I0  every control has an accessible name (aria-label or label text)
 *   I1  every option of every select can be chosen (no option is disabled)
 *   I2  a control holds the value that was just set
 *   I3  no other control changed its value
 *   I4  no control became disabled
 *   I5  no console.error, console.warn or thrown error
 *
 * INTENTIONAL COUPLING: if one control must change another on purpose, list the pair by
 * accessible name. The pair is allowed in both directions (I3 only):
 *
 *   await exploreControls(<MyCard />, { coupled: [["Country", "City"]] });
 *
 * Prefer to remove the coupling: a design where every combination is valid needs none.
 * With more than `maxRuns` runs (default 150), the runs are sampled with a fixed seed. The first,
 * middle and last value of every control are always tried, alone and paired with the first, middle
 * and last value of every other control, in both orders.
 */
import type { ReactElement } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { vi } from "vitest";

type Kind = "select" | "checkbox" | "radio" | "text" | "number";
type Value = string | boolean;

interface Control {
  name: string;
  kind: Kind;
  els: HTMLInputElement[] | HTMLSelectElement[];
}

interface Step {
  name: string;
  value: Value;
}

const DEFAULT_MAX_RUNS = 150;
const TEXT_VALUES = ["", "x", "a".repeat(200), "שלום", "0"];
const NUMBER_VALUES = ["", "0", "1", "99999"];

function nameOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const text = by
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return text;
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length > 0) {
    const clone = labels[0].cloneNode(true) as HTMLElement;
    clone.querySelectorAll("select, input, textarea").forEach((n) => n.remove());
    const text = (clone.textContent ?? "").trim();
    if (text) return text;
  }
  return "";
}

/** Finds the controls. Throws I0 for a control without a name. */
function collect(root: HTMLElement): Control[] {
  const controls: Control[] = [];
  const radios = new Map<string, HTMLInputElement[]>();
  const used = new Map<string, number>();
  const unique = (name: string) => {
    const n = (used.get(name) ?? 0) + 1;
    used.set(name, n);
    return n === 1 ? name : `${name} #${n}`;
  };
  for (const el of Array.from(root.querySelectorAll<HTMLSelectElement | HTMLInputElement>("select, input"))) {
    if (el instanceof HTMLSelectElement) {
      controls.push({ name: requireName(el), kind: "select", els: [el] as unknown as HTMLSelectElement[] });
      continue;
    }
    const type = el.type;
    if (type === "radio") {
      const group = el.name || requireName(el);
      radios.set(group, [...(radios.get(group) ?? []), el]);
    } else if (type === "checkbox") {
      controls.push({ name: requireName(el), kind: "checkbox", els: [el] });
    } else if (type === "number") {
      controls.push({ name: requireName(el), kind: "number", els: [el] });
    } else if (["text", "search", "email", "url", "tel", "password", ""].includes(type)) {
      controls.push({ name: requireName(el), kind: "text", els: [el] });
    }
  }
  for (const [group, els] of radios) controls.push({ name: group, kind: "radio", els });
  return controls.map((c) => ({ ...c, name: unique(c.name) }));
}

function requireName(el: Element): string {
  const name = nameOf(el);
  if (!name) throw new Error(`I0 violated: a control has no accessible name (aria-label or label text): ${el.outerHTML}`);
  return name;
}

function valuesOf(c: Control): Value[] {
  if (c.kind === "select") return Array.from((c.els[0] as HTMLSelectElement).options).map((o) => o.value);
  if (c.kind === "checkbox") return [true, false];
  if (c.kind === "radio") return (c.els as HTMLInputElement[]).map((r) => nameOf(r) || r.value);
  return c.kind === "number" ? NUMBER_VALUES : TEXT_VALUES;
}

function read(c: Control): Value {
  if (c.kind === "checkbox") return (c.els[0] as HTMLInputElement).checked;
  if (c.kind === "radio") {
    const on = (c.els as HTMLInputElement[]).find((r) => r.checked);
    return on ? nameOf(on) || on.value : "";
  }
  return (c.els[0] as HTMLInputElement | HTMLSelectElement).value;
}

async function write(c: Control, value: Value): Promise<void> {
  await act(async () => {
    if (c.kind === "checkbox") {
      if ((c.els[0] as HTMLInputElement).checked !== value) fireEvent.click(c.els[0]);
    } else if (c.kind === "radio") {
      const r = (c.els as HTMLInputElement[]).find((e) => (nameOf(e) || e.value) === value);
      if (r) fireEvent.click(r);
    } else {
      fireEvent.change(c.els[0], { target: { value } });
    }
  });
}

function snapshot(controls: Control[]): Map<string, Value> {
  return new Map(controls.map((c) => [c.name, read(c)]));
}

function disabledOptions(c: Control): string[] {
  return c.kind === "select" ? Array.from((c.els[0] as HTMLSelectElement).options).filter((o) => o.disabled).map((o) => o.text) : [];
}

function disabledControls(controls: Control[]): Set<string> {
  return new Set(controls.filter((c) => c.els.some((e) => e.disabled)).map((c) => c.name));
}

/** A small fixed-seed generator (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function describeSteps(steps: Step[]): string {
  return steps.map((s) => `${s.name} = ${JSON.stringify(s.value)}`).join(" -> ");
}

export async function exploreControls(ui: ReactElement, opts: { coupled?: Array<[string, string]>; maxRuns?: number } = {}): Promise<void> {
  const coupled = opts.coupled ?? [];
  const maxRuns = opts.maxRuns ?? DEFAULT_MAX_RUNS;
  const isCoupled = (a: string, b: string) => coupled.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

  // Plan the runs from one render.
  const first = render(ui);
  const initial = collect(first.container);
  const plan = initial.map((c) => ({ name: c.name, values: valuesOf(c) }));
  first.unmount();

  const runs: Step[][] = [];
  for (const a of plan) for (const v of a.values) runs.push([{ name: a.name, value: v }]);
  for (const a of plan) {
    for (const b of plan) {
      if (a.name === b.name) continue;
      for (const va of a.values) for (const vb of b.values) runs.push([{ name: a.name, value: va }, { name: b.name, value: vb }]);
    }
  }
  let selected = runs;
  if (runs.length > maxRuns) {
    const keep = new Map(plan.map((p) => [p.name, new Set([p.values[0], p.values[Math.floor(p.values.length / 2)], p.values[p.values.length - 1]])]));
    const extremes = runs.filter((r) => r.every((s) => keep.get(s.name)!.has(s.value)));
    const rest = runs.filter((r) => !extremes.includes(r));
    const next = rng(20260101);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    selected = [...extremes, ...rest].slice(0, Math.max(maxRuns, extremes.length));
  }

  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    // Runs that start with the same step share one render: the first step is done once, then each
    // second step is tried in turn. A render costs about as much as two steps, so this is the main saving.
    const groups = new Map<string, { first?: Step; seconds: Step[] }>();
    for (const steps of selected.length ? selected : [[]]) {
      const key = steps[0] ? `${steps[0].name} ${JSON.stringify(steps[0].value)}` : "";
      const group = groups.get(key) ?? { first: steps[0], seconds: [] };
      if (steps[1]) group.seconds.push(steps[1]);
      groups.set(key, group);
    }
    for (const { first, seconds } of groups.values()) {
      const view = render(ui);
      const done: Step[] = [];
      const fail = (rule: string, who: string, detail: string): never => {
        throw new Error(`${rule} violated for control "${who}" after actions [${describeSteps(done) || "none"}]: ${detail}`);
      };
      try {
        const startControls = collect(view.container);
        const startDisabled = disabledControls(startControls);
        const check = (controls: Control[], justSet?: Step) => {
          for (const c of controls) {
            const bad = disabledOptions(c);
            if (bad.length) fail("I1", c.name, `options cannot be chosen (disabled): ${bad.join(", ")}`);
          }
          for (const name of disabledControls(controls)) {
            if (!startDisabled.has(name)) fail("I4", name, "the control became disabled");
          }
          if (errorSpy.mock.calls.length || warnSpy.mock.calls.length) {
            const call = (errorSpy.mock.calls[0] ?? warnSpy.mock.calls[0]).map(String).join(" ");
            fail("I5", justSet?.name ?? "(initial)", `console output: ${call.slice(0, 300)}`);
          }
        };
        check(startControls);

        const applyStep = async (step: Step) => {
          const before = snapshot(collect(view.container));
          const control = collect(view.container).find((c) => c.name === step.name);
          if (!control) fail("I3", step.name, "the control disappeared");
          done.push(step);
          try {
            await write(control!, step.value);
          } catch (e) {
            fail("I5", step.name, `an error was thrown: ${e instanceof Error ? e.message : String(e)}`);
          }
          const controls = collect(view.container);
          const after = snapshot(controls);
          if (after.get(step.name) !== step.value) {
            fail("I2", step.name, `set to ${JSON.stringify(step.value)} but holds ${JSON.stringify(after.get(step.name))}`);
          }
          for (const [name, was] of before) {
            if (name === step.name || isCoupled(step.name, name)) continue;
            if (after.get(name) !== was) {
              fail("I3", name, `changed from ${JSON.stringify(was)} to ${JSON.stringify(after.get(name))} when "${step.name}" was set to ${JSON.stringify(step.value)}`);
            }
          }
          check(controls, step);
        };
        if (first) await applyStep(first);
        for (const second of seconds) {
          done.length = 1;
          await applyStep(second);
        }
      } finally {
        view.unmount();
        errorSpy.mockClear();
        warnSpy.mockClear();
      }
    }
  } finally {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  }
}
