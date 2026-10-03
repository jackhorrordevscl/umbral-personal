import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import FormField from "./FormField";

describe("FormField (#298)", () => {
  it("enlaza el input con su error vía aria-invalid y aria-describedby", () => {
    render(
      <FormField id="f" label="Nombre" error="Requerido">
        <input id="f" />
      </FormField>,
    );
    const input = screen.getByLabelText("Nombre");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "Requerido",
    );
  });

  it("no marca el input como inválido sin error", () => {
    render(
      <FormField id="f" label="Nombre">
        <input id="f" />
      </FormField>,
    );
    const input = screen.getByLabelText("Nombre");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });
});
