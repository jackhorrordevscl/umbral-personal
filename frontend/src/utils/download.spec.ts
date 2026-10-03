import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadBlob } from "./download";

describe("downloadBlob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.URL.createObjectURL = vi.fn(() => "blob:fake");
    window.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("agrega el enlace al DOM durante el clic y lo retira después", () => {
    let attachedAtClick = false;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      attachedAtClick = document.body.contains(this);
      expect(this.download).toBe("reporte.pdf");
    });

    downloadBlob(new Blob(["x"]), "reporte.pdf");

    expect(attachedAtClick).toBe(true);
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("revoca la URL con retraso, no inmediatamente", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadBlob(new Blob(["x"]), "a.txt");
    expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });
});
