export type Theme = "light" | "dark";

// Same key as the landing (umbral.groundzerodevs.com), so the choice is
// consistent between both sites in the same browser profile.
export const THEME_STORAGE_KEY = "umbral-theme";

const THEME_COLOR: Record<Theme, string> = {
  light: "#faf8f0",
  dark: "#0b1120",
};

const listeners = new Set<() => void>();

/** Source of truth is the `dark` class on <html> (set before paint by /theme-init.js). */
export function getTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[theme]);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // storage blocked: the theme still switches for this visit
  }
  listeners.forEach((listener) => listener());
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
