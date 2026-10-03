import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecoveryCodesReveal from "./RecoveryCodesReveal";

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
  });
}

function renderReveal() {
  render(
    <RecoveryCodesReveal
      codes={["AAAA-1111", "BBBB-2222"]}
      onContinue={vi.fn()}
      continueLabel="Continuar"
    />,
  );
}

describe("RecoveryCodesReveal", () => {
  afterEach(() => {
    setClipboard(undefined);
  });

  it("copia los códigos y confirma", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    renderReveal();

    await userEvent.click(
      screen.getByRole("button", { name: "Copiar todos los códigos" }),
    );

    expect(writeText).toHaveBeenCalledWith("AAAA-1111\nBBBB-2222");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Códigos copiados",
    );
  });

  it("avisa que copie manualmente si el portapapeles falla", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    renderReveal();

    await userEvent.click(
      screen.getByRole("button", { name: "Copiar todos los códigos" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("manualmente");
  });

  it("avisa si navigator.clipboard no existe", async () => {
    setClipboard(undefined);
    renderReveal();

    await userEvent.click(
      screen.getByRole("button", { name: "Copiar todos los códigos" }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
