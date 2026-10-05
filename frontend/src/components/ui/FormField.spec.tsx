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

  it("enlaza el control aunque esté envuelto (input + ícono)", () => {
    render(
      <FormField id="f" label="Nombre" error="Requerido">
        <div className="relative">
          <input id="f" aria-describedby="hint" />
          <span aria-hidden="true">i</span>
        </div>
      </FormField>,
    );
    const input = screen.getByLabelText("Nombre");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const ids = input.getAttribute("aria-describedby")!.split(" ");
    expect(ids).toContain("hint");
    expect(
      document.getElementById(ids.find((i) => i !== "hint")!),
    ).toHaveTextContent("Requerido");
  });

  it("no remonta el control envuelto al aparecer el error", () => {
    const { rerender } = render(
      <FormField id="f" label="Nombre">
        <div>
          <input id="f" />
        </div>
      </FormField>,
    );
    const before = screen.getByLabelText("Nombre");
    rerender(
      <FormField id="f" label="Nombre" error="Requerido">
        <div>
          <input id="f" />
        </div>
      </FormField>,
    );
    expect(screen.getByLabelText("Nombre")).toBe(before);
  });
});
