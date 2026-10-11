import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { useDialogA11y } from "./ui/useDialogA11y";
import { IDLE_WARNING_SECONDS } from "../hooks/useIdleTimeout";

const WARNING_SECONDS = IDLE_WARNING_SECONDS;

interface IdleWarningModalProps {
  onExtend: () => void;
  onLogout: () => void;
}

export default function IdleWarningModal({
  onExtend,
  onLogout,
}: IdleWarningModalProps) {
  // Deadline absoluto en vez de contar ticks: setInterval se estrangula en
  // pestañas ocultas y se detiene al suspender el equipo, así que restar 1 por
  // tick podía alargar mucho los 2 min (issue #293). Cada tick (y cada vez que
  // la pestaña vuelve a ser visible) recalcula lo que queda con Date.now().
  const [deadline] = useState(() => Date.now() + WARNING_SECONDS * 1000);
  const [seconds, setSeconds] = useState(WARNING_SECONDS);
  const extendRef = useRef<HTMLButtonElement>(null);
  const logoutRef = useRef<HTMLButtonElement>(null);

  useDialogA11y();

  // Un solo interval creado al montar (antes se recreaba cada segundo por
  // depender de `seconds`); el logout al llegar a 0 se dispara en un efecto
  // aparte que observa el estado, no desde dentro del updater (issue #16).
  useEffect(() => {
    const tick = () =>
      setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    const interval = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [deadline]);

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
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full focus:outline-none max-w-sm p-6 text-center"
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
