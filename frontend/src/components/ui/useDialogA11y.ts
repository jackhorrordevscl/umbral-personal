import { useEffect, useState } from "react";

/**
 * Comportamiento común de los diálogos modales (#298): al montar guarda el
 * elemento que tenía el foco y bloquea el scroll del body; al desmontar
 * restaura ambos. El elemento se captura en el render inicial, antes de que
 * los efectos o el autoFocus de los hijos muevan el foco.
 */
export function useDialogA11y(): void {
  const [previouslyFocused] = useState<HTMLElement | null>(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && previouslyFocused.isConnected)
        previouslyFocused.focus();
    };
  }, [previouslyFocused]);
}
