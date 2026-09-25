import type { ReactNode } from "react";

interface EmptyStateProps {
  message: string;
  /** Ícono opcional sobre el mensaje. */
  icon?: ReactNode;
  /** Clases extra (padding/margen) para ajustar el espaciado de cada lugar. */
  className?: string;
}

// #204: el estado "sin resultados" estaba armado con markup distinto en cada
// página; este componente es el único patrón.
export default function EmptyState({ message, icon, className = "" }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center gap-2 py-8 text-center text-slate-500 ${className}`}>
      {icon}
      <p className="text-sm">{message}</p>
    </div>
  );
}
