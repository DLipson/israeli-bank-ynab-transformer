import { useState } from "react";
import { describe, it, expect } from "vitest";
import { exploreControls } from "@/test/explore-controls";

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];

function Options({ isDisabled = () => false }: { isDisabled?: (m: string) => boolean }) {
  return (
    <>
      {MONTHS.map((m) => (
        <option key={m} value={m} disabled={isDisabled(m)}>
          {m}
        </option>
      ))}
    </>
  );
}

/** Bug 1: choosing one month moves the other one. */
function AutoMove() {
  const [from, setFrom] = useState("2026-02");
  const [to, setTo] = useState("2026-02");
  return (
    <div>
      <select aria-label="From" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }}>
        <Options />
      </select>
      <select aria-label="To" value={to} onChange={(e) => { setTo(e.target.value); if (e.target.value < from) setFrom(e.target.value); }}>
        <Options />
      </select>
    </div>
  );
}

/** Bug 2: options are disabled by the other select. */
function DisabledByOther() {
  const [from, setFrom] = useState("2026-02");
  const [to, setTo] = useState("2026-02");
  return (
    <div>
      <select aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)}>
        <Options isDisabled={(m) => m > to} />
      </select>
      <select aria-label="To" value={to} onChange={(e) => setTo(e.target.value)}>
        <Options isDisabled={(m) => m < from} />
      </select>
    </div>
  );
}

/** Correct: two independent selects. */
function Independent() {
  const [from, setFrom] = useState("2026-02");
  const [to, setTo] = useState("2026-02");
  return (
    <div>
      <label>
        From
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          <Options />
        </select>
      </label>
      <label>
        To
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          <Options />
        </select>
      </label>
    </div>
  );
}

describe("exploreControls", { timeout: 60_000 }, () => {
  it("finds a control that moves another control (I3)", async () => {
    await expect(exploreControls(<AutoMove />)).rejects.toThrow(/I3 violated/);
  });

  it("allows the same coupling when it is declared", async () => {
    await expect(exploreControls(<AutoMove />, { coupled: [["From", "To"]] })).resolves.toBeUndefined();
  });

  it("finds options that the other control disables (I1)", async () => {
    await expect(exploreControls(<DisabledByOther />)).rejects.toThrow(/I1 violated/);
  });

  it("passes independent controls", async () => {
    await expect(exploreControls(<Independent />)).resolves.toBeUndefined();
  });

  it("fails a control without a name (I0)", async () => {
    await expect(exploreControls(<input />)).rejects.toThrow(/I0 violated/);
  });
});
