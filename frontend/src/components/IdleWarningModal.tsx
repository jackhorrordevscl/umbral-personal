import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (seconds <= 0) {
      onLogout();
      return;
    }
    const interval = setInterval(() => {
      setSeconds((s) => s - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [seconds, onLogout]);

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const countdown = `${minutes}:${secs.toString().padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
        <div className="flex items-center justify-center w-12 h-12 bg-amber-100 rounded-full mx-auto mb-4">
          <AlertTriangle size={24} className="text-amber-500" />
        </div>
        <h3 className="font-display text-xl text-slate-900 mb-2">
          Sesión por expirar
        </h3>
        <p className="text-slate-500 text-sm mb-4">
          Por inactividad, tu sesión se cerrará en
        </p>
        <div className="text-4xl font-mono font-bold text-amber-500 mb-6">
          {countdown}
        </div>
        <div className="flex gap-3">
          <button onClick={onExtend} className="btn-primary flex-1">
            Continuar sesión
          </button>
          <button onClick={onLogout} className="btn-secondary flex-1">
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
