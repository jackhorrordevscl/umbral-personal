import type { KeyboardEvent } from "react";

/**
 * Keyboard handler for non-button elements acting as buttons (role="button"):
 * triggers `fn` on Enter or Space, like a native <button>.
 */
export const activateOnKey =
  (fn: () => void) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
