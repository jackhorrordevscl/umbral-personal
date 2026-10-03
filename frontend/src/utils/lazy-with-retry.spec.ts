import { describe, it, expect, vi, beforeEach } from "vitest";
import { importWithRetry } from "./lazy-with-retry";
import { reloadPage } from "./reload";

vi.mock("./reload", () => ({ reloadPage: vi.fn() }));

describe("importWithRetry", () => {
  beforeEach(() => {
    vi.mocked(reloadPage).mockClear();
    sessionStorage.clear();
  });

  it("reintenta y resuelve si un intento posterior funciona", async () => {
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error("chunk"))
      .mockResolvedValueOnce({ default: "ok" });

    await expect(importWithRetry(factory, [1, 1])).resolves.toEqual({
      default: "ok",
    });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("recarga una sola vez al agotar reintentos y luego propaga el error", async () => {
    const error = new Error("chunk");
    const factory = vi.fn().mockRejectedValue(error);

    // Primer ciclo: recarga y queda pendiente (la página se está recargando).
    const pending = importWithRetry(factory, [1]);
    const settled = vi.fn();
    void pending.then(settled, settled);
    await new Promise((r) => setTimeout(r, 30));
    expect(factory).toHaveBeenCalledTimes(2);
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();

    // Segundo ciclo (ya recargado): se propaga el error, sin otro reload.
    await expect(importWithRetry(factory, [1])).rejects.toBe(error);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});
