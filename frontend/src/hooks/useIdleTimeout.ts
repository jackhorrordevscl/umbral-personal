import { useEffect, useRef, useCallback } from "react";

const IDLE_TIMEOUT = 8 * 60 * 1000;

interface UseIdleTimeoutOptions {
  onWarn: () => void;
}

export function useIdleTimeout({ onWarn }: UseIdleTimeoutOptions) {
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "click",
    ];
    const handleActivity = () => startTimers();
    events.forEach((e) => window.addEventListener(e, handleActivity));
    startTimers();
    return () => {
      events.forEach((e) => window.removeEventListener(e, handleActivity));
      clearTimers();
    };
  }, [startTimers, clearTimers]);

  const extend = useCallback(() => {
    clearTimers();
    startTimers();
  }, [clearTimers, startTimers]);

  return { extend };
}
