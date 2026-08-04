import { AlertCircle } from "lucide-react";

interface ErrorBannerProps {
  message: string;
  variant?: "error" | "success";
  /** Ícono AlertCircle + layout en fila (algunos banners lo llevan, otros no). */
  icon?: boolean;
  /** Clases extra (margen) para preservar el espaciado de cada lugar donde se usa. */
  className?: string;
}

const VARIANT_STYLES = {
  error: {
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-600",
    icon: "text-red-500",
  },
  success: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
    icon: "text-emerald-600",
  },
} as const;

// #73 (punto 6): el mismo markup (bg-{color}-50 border rounded-lg p-3 +
// texto) estaba copiado en 15+ lugares de la app, con variaciones menores
// (con/sin ícono, distinto margen) que ya empezaban a divergir.
export default function ErrorBanner({
  message,
  variant = "error",
  icon = false,
  className = "",
}: ErrorBannerProps) {
  const styles = VARIANT_STYLES[variant];

  return (
    <div
      className={`${styles.bg} border ${styles.border} rounded-lg p-3 ${icon ? "flex items-center gap-2" : ""} ${className}`}
    >
      {icon && <AlertCircle size={14} className={`${styles.icon} shrink-0`} />}
      <p className={`${styles.text} text-sm`}>{message}</p>
    </div>
  );
}
