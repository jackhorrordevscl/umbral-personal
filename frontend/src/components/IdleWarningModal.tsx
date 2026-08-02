import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle } from "lucide-react";

interface IdleWarningModalProps {
  onExtend: () => void;
  onLogout: () => void;
}

export default function IdleWarningModal({
  onExtend,
  onLogout,
}: IdleWarningModalProps) {
  const [seconds, setSeconds] = useState(119);
  const extendRef = useRef<HTMLButtonElement>(null);
  const logoutRef = useRef<HTMLButtonElement>(null);

  // Un solo interval creado al montar (antes se recreaba cada segundo por
  // depender de `seconds`); el logout al llegar a 0 se dispara en un efecto
  // aparte que observa el estado, no desde dentro del updater (issue #16).
  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (seconds === 0) onLogout();
  }, [seconds, onLogout]);

  // Foco inicial en la acción principal (mantener sesión) al abrir el modal.
  useEffect(() => {
    extendRef.current?.focus();
  }, []);

  // Focus trap simple: solo hay dos elementos enfocables en este diálogo.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    if (e.shiftKey && document.activeElement === extendRef.current) {
      e.preventDefault();
      logoutRef.current?.focus();
    } else if (!e.shiftKey && document.activeElement === logoutRef.current) {
      e.preventDefault();
      extendRef.current?.focus();
    }
  };

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const countdown = `${minutes}:${secs.toString().padStart(2, "0")}`;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4"
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="idle-warning-title"
        aria-describedby="idle-warning-desc"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center"
      >
        <div className="flex items-center justify-center w-12 h-12 bg-amber-100 rounded-full mx-auto mb-4">
          <AlertTriangle size={24} className="text-amber-500" />
        </div>
        <h3 id="idle-warning-title" className="font-display text-xl text-slate-900 mb-2">
          Sesión por expirar
        </h3>
        <p id="idle-warning-desc" className="text-slate-500 text-sm mb-4">
          Por inactividad, tu sesión se cerrará en
        </p>
        <div
          role="timer"
          aria-live="polite"
          aria-atomic="true"
          className="text-4xl font-mono font-bold text-amber-500 mb-6"
        >
          {countdown}
        </div>
        <div className="flex gap-3">
          <button ref={extendRef} onClick={onExtend} className="btn-primary flex-1">
            Continuar sesión
          </button>
          <button ref={logoutRef} onClick={onLogout} className="btn-secondary flex-1">
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
