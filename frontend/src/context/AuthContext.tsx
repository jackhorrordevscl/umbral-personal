import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthContext, type User } from './useAuth';
import api from '../api/client';
import { ACTIVITY_STORAGE_KEY } from '../hooks/useIdleTimeout';

function setActivityMark(value: number | null) {
  try {
    if (value === null) localStorage.removeItem(ACTIVITY_STORAGE_KEY);
    else localStorage.setItem(ACTIVITY_STORAGE_KEY, String(value));
  } catch {
    // Storage no disponible: el control de inactividad queda en el temporizador.
  }
}

// Issue #387: la sesión vive en una cookie HttpOnly que JavaScript no puede
// leer. En localStorage queda solo `user` (dato no secreto) como marcador de
// que hay sesión; si la cookie ya expiró, el primer 401 cierra la sesión. El
// `token` de versiones anteriores se descarta: ya no se usa y no debe
// quedar a mano de un XSS.
//
// Leído una sola vez, como inicializador perezoso de useState en vez de un
// useEffect: evita el re-render en cascada de setState-en-efecto (issue
// #60) y de paso hace que el usuario ya esté disponible en el primer render
// en vez de aparecer un instante después.
function readStoredAuth(): { user: User | null } {
  localStorage.removeItem('token');
  const storedUser = localStorage.getItem('user');
  if (!storedUser) return { user: null };

  try {
    return { user: JSON.parse(storedUser) };
  } catch {
    // localStorage.user corrupto: tratar como no autenticado en vez de
    // romper el render inicial de toda la app (issue #15).
    localStorage.removeItem('user');
    return { user: null };
  }
}

// Issue #351: otra pestaña puede escribir `user` y el navegador dispara un
// evento `storage`. Se espera este margen tras el último evento y recién
// entonces se lee, para no adoptar un estado a medias.
export const STORAGE_SYNC_DELAY_MS = 50;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [{ user }, setAuth] = useState(readStoredAuth);
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
  const authRef = useRef({ user });
  useEffect(() => {
    authRef.current = { user };
  }, [user]);

  // Issue #291: el QueryClient es un singleton y sus claves no incluyen al
  // usuario, así que sin vaciarlo el siguiente usuario de un equipo compartido
  // vería fichas y perfil del anterior desde el caché. Se vacía en login y en
  // logout (este último cubre el 401 y el cierre por inactividad).
  //
  // Issue #387: el servidor ya dejó la cookie de sesión en la respuesta de
  // login; acá solo se guarda el usuario como marcador de sesión.
  const login = (newUser: User) => {
    queryClient.clear();
    localStorage.setItem('user', JSON.stringify(newUser));
    // Una marca de una sesión anterior no debe cerrar esta recién abierta.
    setActivityMark(Date.now());
    setCanRestoreRoute(true);
    setAuth({ user: newUser });
  };

  // `expired`: la sesión caducó (401), no fue una decisión del usuario; solo ahí
  // se conserva la ruta para volver a ella tras iniciar sesión (#351).
  const logout = (options?: { expired?: boolean }) => {
    // Issue #192: revoke the session server-side, best-effort. It stays
    // synchronous for callers: any failure (offline, already-expired session)
    // is ignored -- the local logout wins. Issue #387: la respuesta además
    // borra la cookie de sesión.
    if (authRef.current.user) {
      api.post('/auth/logout').catch(() => {});
    }
    localStorage.removeItem('user');
    setActivityMark(null);
    queryClient.clear();
    setCanRestoreRoute(!!options?.expired);
    setAuth({ user: null });
  };

  // Issue #293: `user` vive en localStorage y es compartido por todas las
  // pestañas (y la cookie de sesión también). Si otra pestaña inicia sesión con
  // otra cuenta o cierra sesión, esta seguiría mostrando al usuario anterior.
  // El evento `storage` solo se dispara en las OTRAS pestañas, así que no hay
  // eco de los cambios propios.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reconcile = () => {
      timer = null;
      const next = readStoredAuth();
      const prev = authRef.current;
      if (prev.user?.id === next.user?.id) return;
      // Otra cuenta (o sin cuenta): el caché del usuario anterior no debe
      // sobrevivir, mismo motivo que en login/logout (#291).
      queryClient.clear();
      // Cierre de sesión (o cambio de cuenta) hecho en otra pestaña: no se
      // recuerda la ruta de esta (#351).
      if (!next.user) setCanRestoreRoute(false);
      setAuth(next);
    };
    const handleStorage = (e: StorageEvent) => {
      // key === null es localStorage.clear().
      if (e.key !== null && e.key !== 'user') return;
      // Se difiere y se reinicia con cada evento: la lectura ocurre una sola
      // vez, cuando el valor ya está escrito (#351).
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
        login,
        logout,
        isAuthenticated: !!user,
        canRestoreRoute,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
