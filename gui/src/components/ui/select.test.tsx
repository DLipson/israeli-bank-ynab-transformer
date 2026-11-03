import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Select } from "@/components/ui/select";
import { exploreControls } from "@/test/explore-controls";

const NUMBERS = [
  { value: 1, label: "One" },
  { value: 12, label: "Twelve" },
];

function Two() {
  const [a, setA] = useState(1);
  const [b, setB] = useState("x");
  return (
    <div>
      <Select aria-label="A" value={a} onChange={setA} options={NUMBERS} />
      <Select aria-label="B" value={b} onChange={setB} options={[{ value: "x", label: "X" }, { value: "y", label: "Y" }]} />
    </div>
  );
}

describe("Select", () => {
  it("hands back the typed option value, a number stays a number", () => {
    const onChange = vi.fn();
    render(<Select aria-label="Months" value={1} onChange={onChange} options={NUMBERS} />);
    fireEvent.change(screen.getByLabelText("Months"), { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith(12);
  });

  it("always offers the empty choice, and choosing it gives an empty value", () => {
    const options = [{ value: "a", label: "A" }];
    const onChange = vi.fn();
    const { rerender } = render(<Select aria-label="Pick" value="" onChange={onChange} options={options} emptyLabel="Nothing" />);
    expect(screen.getByRole("option", { name: "Nothing" })).toBeInTheDocument();
    rerender(<Select aria-label="Pick" value="a" onChange={onChange} options={options} emptyLabel="Nothing" />);
    expect(screen.getByRole("option", { name: "Nothing" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pick"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("keeps two selects independent", async () => {
    await exploreControls(<Two />);
  });
});
