import { useEffect, useRef, type KeyboardEvent } from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// Issue #41: reemplaza confirm()/alert() nativos en acciones destructivas
// (eliminar paciente, eliminar archivo). Mismo patrón de diálogo accesible
// que IdleWarningModal (role="dialog", foco inicial, focus trap, Escape).
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Eliminar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    if (e.shiftKey && document.activeElement === cancelRef.current) {
      e.preventDefault();
      confirmRef.current?.focus();
    } else if (!e.shiftKey && document.activeElement === confirmRef.current) {
      e.preventDefault();
      cancelRef.current?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4"
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center"
      >
        <div className="flex items-center justify-center w-12 h-12 bg-red-100 rounded-full mx-auto mb-4">
          <AlertTriangle size={24} className="text-red-500" />
        </div>
        <h3 id="confirm-dialog-title" className="font-display text-xl text-slate-900 mb-2">
          {title}
        </h3>
        <p id="confirm-dialog-desc" className="text-slate-500 text-sm mb-6">
          {message}
        </p>
        <div className="flex gap-3">
          <button ref={cancelRef} onClick={onCancel} className="btn-secondary flex-1">
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white font-medium px-4 py-2 rounded-lg transition-all duration-200 text-sm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
