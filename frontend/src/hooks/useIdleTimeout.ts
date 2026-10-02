import { useEffect, useRef, useCallback } from "react";

const IDLE_TIMEOUT = 8 * 60 * 1000;
const ACTIVITY_CHANNEL = "umbral-activity";
const ACTIVITY_STORAGE_KEY = "umbral:last-activity";
// Evita inundar el canal: mousemove/scroll disparan decenas de eventos por segundo.
const BROADCAST_THROTTLE_MS = 1000;

interface UseIdleTimeoutOptions {
  onWarn: () => void;
  /** Actividad detectada en otra pestaña (p. ej. para cerrar el aviso abierto). */
  onRemoteActivity?: () => void;
}

/**
 * Avisa a las demás pestañas de que hubo actividad. El token vive en
 * localStorage y es compartido, así que el temporizador de inactividad debe
 * serlo también: una pestaña quieta no puede cerrar la sesión de la activa
 * (issue #293). BroadcastChannel cuando existe; si no, evento `storage`.
 */
function createActivitySync(onRemoteActivity: () => void) {
  let channel: BroadcastChannel | null = null;
  let storageHandler: ((e: StorageEvent) => void) | null = null;

  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(ACTIVITY_CHANNEL);
    channel.onmessage = () => onRemoteActivity();
  } else {
    storageHandler = (e) => {
      if (e.key === ACTIVITY_STORAGE_KEY) onRemoteActivity();
    };
    window.addEventListener("storage", storageHandler);
  }

  return {
    notify() {
      if (channel) {
        channel.postMessage(Date.now());
        return;
      }
      try {
        localStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()));
      } catch {
        // Storage no disponible: solo se pierde la sincronización.
      }
    },
    close() {
      channel?.close();
      if (storageHandler) window.removeEventListener("storage", storageHandler);
    },
  };
}

export function useIdleTimeout({
  onWarn,
  onRemoteActivity,
}: UseIdleTimeoutOptions) {
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRemoteActivityRef = useRef(onRemoteActivity);
  useEffect(() => {
    onRemoteActivityRef.current = onRemoteActivity;
  }, [onRemoteActivity]);

  const clearTimers = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const startTimers = useCallback(() => {
    clearTimers();
    idleTimer.current = setTimeout(() => {
      onWarn();
    }, IDLE_TIMEOUT);
  }, [clearTimers, onWarn]);

  useEffect(() => {
    // El scroll real ocurre en contenedores internos (main.overflow-auto) y no
    // burbujea hasta window: se escucha en fase de captura. `wheel` cubre la
    // lectura de una ficha larga solo con la rueda.
    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "wheel",
      "click",
    ];
    const options = { passive: true, capture: true } as const;

    const sync = createActivitySync(() => {
      startTimers();
      onRemoteActivityRef.current?.();
    });
    let lastBroadcast = 0;
    const handleActivity = () => {
      startTimers();
      const now = Date.now();
      if (now - lastBroadcast >= BROADCAST_THROTTLE_MS) {
        lastBroadcast = now;
        sync.notify();
      }
    };

    events.forEach((e) => window.addEventListener(e, handleActivity, options));
    startTimers();
    return () => {
      events.forEach((e) =>
        window.removeEventListener(e, handleActivity, options),
      );
      sync.close();
      clearTimers();
    };
  }, [startTimers, clearTimers]);

  const extend = useCallback(() => {
    clearTimers();
    startTimers();
  }, [clearTimers, startTimers]);

  return { extend };
}
