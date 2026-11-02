import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

const OPTIONS = [{ value: "a", label: "A" }];

describe("Field", () => {
  it("names the wrapped control by its label", () => {
    render(
      <Field label="Up to" hint="Some hint">
        <Select value="a" onChange={() => {}} options={OPTIONS} />
      </Field>
    );
    expect(screen.getByLabelText("Up to")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByText("Some hint")).toBeInTheDocument();
  });

  it("announces the error", () => {
    render(
      <Field label="Up to" error="Bad month">
        <Select value="a" onChange={() => {}} options={OPTIONS} />
      </Field>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Bad month");
  });
});
