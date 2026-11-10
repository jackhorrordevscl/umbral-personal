import { useSyncExternalStore } from "react";
import {
  getTheme,
  subscribeTheme,
  toggleTheme,
  type Theme,
} from "../utils/theme";

export function useTheme(): { theme: Theme; toggle: () => Theme } {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => "light" as Theme);
  return { theme, toggle: toggleTheme };
}
