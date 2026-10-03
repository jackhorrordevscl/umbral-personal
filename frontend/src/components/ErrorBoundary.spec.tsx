import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as Sentry from "@sentry/react";
import ErrorBoundary from "./ErrorBoundary";
import { reloadPage } from "../utils/reload";

vi.mock("../utils/reload", () => ({ reloadPage: vi.fn() }));
vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));

function Boom(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React registra el error capturado en console.error.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renderiza los hijos cuando no hay error", () => {
    render(
      <ErrorBoundary>
        <p>contenido</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("contenido")).toBeInTheDocument();
  });

  it("muestra el fallback, reporta el error y Recargar recarga la página", async () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Algo salió mal")).toBeInTheDocument();
    expect(Sentry.captureException).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Recargar" }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});
