import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import Modal from "./Modal";
import ConfirmDialog from "./ConfirmDialog";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      {open && (
        <Modal onClose={() => setOpen(false)} labelledBy="t">
          <h3 id="t">Título</h3>
          <button>Dentro</button>
        </Modal>
      )}
    </>
  );
}

describe("Modal (#298)", () => {
  it("bloquea el scroll del body y lo restaura al cerrar", () => {
    document.body.style.overflow = "";
    render(<Harness />);
    fireEvent.click(screen.getByText("Abrir"));
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(document.body.style.overflow).toBe("");
  });

  it("devuelve el foco al elemento que abrió el modal", () => {
    render(<Harness />);
    const opener = screen.getByText("Abrir");
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByText("Dentro")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(opener).toHaveFocus();
  });

  it("enfoca el panel (tabIndex -1) si no hay elementos enfocables", () => {
    render(
      <Modal onClose={vi.fn()} labelledBy="t">
        <h3 id="t">Solo texto</h3>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
  });
});

describe("ConfirmDialog (#298)", () => {
  it("bloquea el scroll y restaura foco y scroll al desmontarse", () => {
    document.body.style.overflow = "";
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <ConfirmDialog
        title="T"
        message="M"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
