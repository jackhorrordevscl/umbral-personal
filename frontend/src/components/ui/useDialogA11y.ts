import { useEffect } from "react";

/**
 * Comportamiento común de los diálogos modales (#298): al montar guarda el
 * elemento que tenía el foco y bloquea el scroll del body; al desmontar
 * restaura ambos. Debe llamarse ANTES de cualquier efecto que mueva el foco.
 */
export function useDialogA11y(): void {
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && previouslyFocused.isConnected)
        previouslyFocused.focus();
    };
  }, []);
}
