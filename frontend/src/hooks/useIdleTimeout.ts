import { useEffect, useRef, useCallback } from "react";

export const IDLE_TIMEOUT = 8 * 60 * 1000;
// Duración del aviso previo al cierre; la comparte el modal con la comprobación
// por reloj de pared, que decide entre avisar y expirar directo (issue #367).
export const IDLE_WARNING_SECONDS = 120;
export const ACTIVITY_CHANNEL = "umbral-activity";
export const ACTIVITY_STORAGE_KEY = "umbral:last-activity";
// Evita inundar el canal: mousemove/scroll disparan decenas de eventos por segundo.
const BROADCAST_THROTTLE_MS = 1000;

interface UseIdleTimeoutOptions {
  onWarn: () => void;
  /**
   * Cierre directo: al volver a la app ya pasó el tiempo de inactividad más el
   * del aviso (los temporizadores se congelan en segundo plano, issue #367).
   */
  onExpire?: () => void;
  /** Actividad detectada en otra pestaña (p. ej. para cerrar el aviso abierto). */
  onRemoteActivity?: () => void;
}

function readLastActivity(): number | null {
  try {
    const raw = localStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeLastActivity(timestamp: number) {
  try {
    localStorage.setItem(ACTIVITY_STORAGE_KEY, String(timestamp));
  } catch {
    // Storage no disponible: se degrada al temporizador en memoria.
  }
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
      // Sin BroadcastChannel, la escritura de la marca en localStorage (hecha
      // por el hook) es la propia señal: dispara `storage` en las otras pestañas.
      channel?.postMessage(Date.now());
    },
    close() {
      channel?.close();
      if (storageHandler) window.removeEventListener("storage", storageHandler);
    },
  };
}

export function useIdleTimeout({
  onWarn,
  onExpire,
  onRemoteActivity,
}: UseIdleTimeoutOptions) {
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRemoteActivityRef = useRef(onRemoteActivity);
  const onWarnRef = useRef(onWarn);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onRemoteActivityRef.current = onRemoteActivity;
    onWarnRef.current = onWarn;
    onExpireRef.current = onExpire;
  }, [onRemoteActivity, onWarn, onExpire]);

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
        // La marca persistida permite detectar la inactividad al volver de un
        // segundo plano donde el setTimeout estuvo congelado (issue #367).
        writeLastActivity(now);
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

  // Issue #367: los navegadores móviles congelan los temporizadores con la
  // pestaña en segundo plano o la pantalla bloqueada. Al volver se compara la
  // hora real con la última actividad (compartida entre pestañas).
  useEffect(() => {
    const check = () => {
      const last = readLastActivity();
      if (last === null) {
        // Sin dato legible nunca se expira: se siembra la marca y se sigue.
        writeLastActivity(Date.now());
        return;
      }
      const elapsed = Date.now() - last;
      if (elapsed < IDLE_TIMEOUT) return;
      if (elapsed < IDLE_TIMEOUT + IDLE_WARNING_SECONDS * 1000) {
        onWarnRef.current();
      } else {
        onExpireRef.current?.();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", check);
    check();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", check);
    };
  }, []);

  const extend = useCallback(() => {
    writeLastActivity(Date.now());
    clearTimers();
    startTimers();
  }, [clearTimers, startTimers]);

  return { extend };
}
