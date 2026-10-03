import { lazy, type ComponentType } from "react";
import { reloadPage } from "./reload";

const RELOAD_FLAG = "lazy-chunk-reloaded";
const RETRY_DELAYS_MS = [500, 1500];

function wasReloaded(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) === "1";
  } catch {
    // Sin storage no se puede garantizar un solo reload: se asume ya hecho
    // para evitar un bucle de recargas.
    return true;
  }
}

function markReloaded(): void {
  try {
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    // ignorado: ver wasReloaded
  }
}

function clearReloaded(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // ignorado
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Issue #297: tras un deploy, el import() de un chunk con hash viejo falla y
// la app quedaba en blanco. Se reintenta con una pausa corta; si sigue
// fallando se recarga la página una sola vez (flag en sessionStorage) para
// bajar el index.html nuevo, y si ya se recargó se propaga el error al
// ErrorBoundary.
export function importWithRetry<T>(
  factory: () => Promise<T>,
  delays: number[] = RETRY_DELAYS_MS,
): Promise<T> {
  const attempt = async (): Promise<T> => {
    for (let i = 0; ; i++) {
      try {
        const module = await factory();
        clearReloaded();
        return module;
      } catch (error) {
        if (i < delays.length) {
          await sleep(delays[i]);
          continue;
        }
        if (!wasReloaded()) {
          markReloaded();
          reloadPage();
          // Se mantiene pendiente mientras la página se recarga.
          return new Promise<T>(() => {});
        }
        throw error;
      }
    }
  };
  return attempt();
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() => importWithRetry(factory));
}
