import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ErrorBanner from "./ErrorBanner";
import EmptyState from "./EmptyState";

describe("ErrorBanner", () => {
  it('se anuncia a lectores de pantalla con role="alert"', () => {
    render(<ErrorBanner message="Falló" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Falló");
  });

  it("no muestra botón de cierre sin onDismiss", () => {
    render(<ErrorBanner message="Falló" />);
    expect(screen.getByText("Falló")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cerrar aviso" })).toBeNull();
  });

  it("llama a onDismiss al cerrar", () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner message="Falló" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('no muestra "Reintentar" sin onRetry', () => {
    render(<ErrorBanner message="Falló" />);
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it('llama a onRetry al pulsar "Reintentar"', () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="Falló" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("EmptyState", () => {
  it("muestra el mensaje y el ícono", () => {
    render(
      <EmptyState
        message="Nada por aquí"
        icon={<span data-testid="icono" />}
      />,
    );
    expect(screen.getByText("Nada por aquí")).toBeInTheDocument();
    expect(screen.getByTestId("icono")).toBeInTheDocument();
  });
});
