import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthContext, type User } from './useAuth';
import api from '../api/client';
import { ACTIVITY_STORAGE_KEY } from '../hooks/useIdleTimeout';

// Issue #367: true solo si el JWT trae un `exp` legible y ya pasó. Sin `exp`
// legible (token opaco, payload ilegible) se conserva: el 401 sigue siendo la
// red de seguridad.
function isJwtExpired(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return false;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const { exp } = JSON.parse(atob(padded));
    return typeof exp === 'number' && exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}

function setActivityMark(value: number | null) {
  try {
    if (value === null) localStorage.removeItem(ACTIVITY_STORAGE_KEY);
    else localStorage.setItem(ACTIVITY_STORAGE_KEY, String(value));
  } catch {
    // Storage no disponible: el control de inactividad queda en el temporizador.
  }
}

// Leído una sola vez, como inicializador perezoso de useState en vez de un
// useEffect: evita el re-render en cascada de setState-en-efecto (issue
// #60) y de paso hace que el usuario ya esté disponible en el primer render
// en vez de aparecer un instante después.
function readStoredAuth(): { user: User | null; token: string | null } {
  const storedToken = localStorage.getItem('token');
  const storedUser = localStorage.getItem('user');
  if (!storedToken || !storedUser) return { user: null, token: null };

  if (isJwtExpired(storedToken)) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    return { user: null, token: null };
  }

  try {
    return { user: JSON.parse(storedUser), token: storedToken };
  } catch {
    // localStorage.user corrupto: tratar como no autenticado en vez de
    // romper el render inicial de toda la app (issue #15).
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    return { user: null, token: null };
  }
}

// Issue #351: otra pestaña escribe `token` y `user` en dos operaciones y el
// navegador dispara dos eventos `storage`. Se espera este margen tras el último
// evento y recién entonces se leen ambas claves, para no adoptar un estado
// mezclado (token nuevo con usuario anterior).
export const STORAGE_SYNC_DELAY_MS = 50;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [{ user, token }, setAuth] = useState(readStoredAuth);
  // Issue #351: false cuando la sesión terminó por un logout voluntario o por
  // otra pestaña; PrivateRoute no debe recordar entonces la ruta, para que otra
  // persona que inicie sesión después no aterrice en la del usuario anterior.
  const [canRestoreRoute, setCanRestoreRoute] = useState(true);
  const queryClient = useQueryClient();
  // Espejo del estado para el listener de `storage`, que no debe re-suscribirse
  // en cada cambio de sesión. Sincronizarlo en un useEffect (y no durante el
  // render) es seguro porque las escrituras de esta misma pestaña no disparan
  // `storage`: el listener solo corre por cambios de OTRAS pestañas, nunca entre
  // un setAuth local y la ejecución del efecto que actualiza el ref.
  const authRef = useRef({ user, token });
  useEffect(() => {
    authRef.current = { user, token };
  }, [user, token]);

  // Issue #291: el QueryClient es un singleton y sus claves no incluyen al
  // usuario, así que sin vaciarlo el siguiente usuario de un equipo compartido
  // vería fichas y perfil del anterior desde el caché. Se vacía en login y en
  // logout (este último cubre el 401 y el cierre por inactividad).
  const login = (newToken: string, newUser: User) => {
    queryClient.clear();
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    // Una marca de una sesión anterior no debe cerrar esta recién abierta.
    setActivityMark(Date.now());
    setCanRestoreRoute(true);
    setAuth({ token: newToken, user: newUser });
  };

  // `expired`: la sesión caducó (401), no fue una decisión del usuario; solo ahí
  // se conserva la ruta para volver a ella tras iniciar sesión (#351).
  const logout = (options?: { expired?: boolean }) => {
    // Issue #192: revoke the session server-side, best-effort. It stays
    // synchronous for callers: the request is fired with the current token
    // (explicit header, since storage is cleared right below) and any failure
    // (offline, already-expired token) is ignored -- the local logout wins.
    const currentToken = localStorage.getItem('token');
    if (currentToken) {
      api
        .post('/auth/logout', null, {
          headers: { Authorization: `Bearer ${currentToken}` },
        })
        .catch(() => {});
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setActivityMark(null);
    queryClient.clear();
    setCanRestoreRoute(!!options?.expired);
    setAuth({ token: null, user: null });
  };

  // Issue #293: el token vive en localStorage y es compartido por todas las
  // pestañas. Si otra pestaña inicia sesión con otra cuenta o cierra sesión,
  // esta seguiría mostrando al usuario anterior mientras sus requests van con
  // el token nuevo. El evento `storage` solo se dispara en las OTRAS pestañas,
  // así que no hay eco de los cambios propios.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reconcile = () => {
      timer = null;
      const next = readStoredAuth();
      const prev = authRef.current;
      if (prev.token === next.token && prev.user?.id === next.user?.id) return;
      // Otra cuenta (o sin cuenta): el caché del usuario anterior no debe
      // sobrevivir, mismo motivo que en login/logout (#291). Si solo cambió el
      // token de la misma cuenta, el caché sigue siendo válido.
      if (prev.user?.id !== next.user?.id) queryClient.clear();
      // Cierre de sesión (o cambio de cuenta) hecho en otra pestaña: no se
      // recuerda la ruta de esta (#351).
      if (!next.token) setCanRestoreRoute(false);
      setAuth(next);
    };
    const handleStorage = (e: StorageEvent) => {
      // key === null es localStorage.clear().
      if (e.key !== null && e.key !== 'token' && e.key !== 'user') return;
      // Se difiere y se reinicia con cada evento: la lectura ocurre una sola
      // vez, cuando `token` y `user` ya están ambos escritos (#351).
      if (timer) clearTimeout(timer);
      timer = setTimeout(reconcile, STORAGE_SYNC_DELAY_MS);
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      if (timer) clearTimeout(timer);
    };
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        isAuthenticated: !!token,
        canRestoreRoute,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}