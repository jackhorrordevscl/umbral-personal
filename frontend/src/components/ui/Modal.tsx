import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

interface ModalProps {
  onClose: () => void;
  labelledBy: string;
  describedBy?: string;
  /** Clases adicionales para el panel del diálogo (ancho máximo, padding, overflow). */
  className?: string;
  children: ReactNode;
  /** Elemento a enfocar al abrir; por defecto, el primer elemento enfocable del panel. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// #73 (punto 2): componente base que faltaba desde issue #42 -- PatientModal,
// el modal de corrección de ConsultationsPage, y los dos modales de
// SharedFilesPage manejaban Escape a mano pero no tenían focus trap ni foco
// inicial, a diferencia de ConfirmDialog/IdleWarningModal (que sí lo hacen,
// pero con un trap hardcodeado a 2 botones -- no sirve para un modal con
// forms/tabs). Este trap es genérico: recalcula los elementos enfocables en
// cada Tab, así que sigue funcionando aunque el contenido cambie (tabs,
// formularios condicionales).
export default function Modal({
  onClose,
  labelledBy,
  describedBy,
  className = "",
  children,
  initialFocusRef,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target =
      initialFocusRef?.current ??
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    target?.focus();
    // Solo al montar: no queremos robar el foco de nuevo si el contenido
    // cambia mientras el modal sigue abierto (ej. cambiar de tab).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;

    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={`bg-white rounded-2xl shadow-xl w-full ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
