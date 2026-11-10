import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";

interface ThemeToggleProps {
  /**
   * "icon": 44 px square button (same as the landing), for public screens.
   * "sidebar": full-width row with label, for the dark sidebar.
   */
  variant?: "icon" | "sidebar";
  className?: string;
}

export default function ThemeToggle({ variant = "icon", className = "" }: ThemeToggleProps) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
  // The icon shows the action, matching the label (moon = switch to dark, sun = switch to light).
  const Icon = isDark ? Sun : Moon;

  if (variant === "sidebar") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        className={`sidebar-link w-full text-left ${className}`}
      >
        <Icon size={18} aria-hidden="true" />
        {isDark ? "Modo claro" : "Modo oscuro"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-surface text-slate-700 transition-colors hover:border-sage-500 hover:text-slate-900 ${className}`}
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
