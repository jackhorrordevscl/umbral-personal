import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthContext, type User } from './useAuth';
import api from '../api/client';

// Leído una sola vez, como inicializador perezoso de useState en vez de un
// useEffect: evita el re-render en cascada de setState-en-efecto (issue
// #60) y de paso hace que el usuario ya esté disponible en el primer render
// en vez de aparecer un instante después.
function readStoredAuth(): { user: User | null; token: string | null } {
  const storedToken = localStorage.getItem('token');
  const storedUser = localStorage.getItem('user');
  if (!storedToken || !storedUser) return { user: null, token: null };

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [{ user, token }, setAuth] = useState(readStoredAuth);
  const queryClient = useQueryClient();
  // Espejo del estado para el listener de `storage`, que no debe re-suscribirse
  // en cada cambio de sesión.
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
    setAuth({ token: newToken, user: newUser });
  };

  const logout = () => {
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
    queryClient.clear();
    setAuth({ token: null, user: null });
  };

  // Issue #293: el token vive en localStorage y es compartido por todas las
  // pestañas. Si otra pestaña inicia sesión con otra cuenta o cierra sesión,
  // esta seguiría mostrando al usuario anterior mientras sus requests van con
  // el token nuevo. El evento `storage` solo se dispara en las OTRAS pestañas,
  // así que no hay eco de los cambios propios.
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      // key === null es localStorage.clear().
      if (e.key !== null && e.key !== 'token' && e.key !== 'user') return;
      const next = readStoredAuth();
      const prev = authRef.current;
      if (prev.token === next.token && prev.user?.id === next.user?.id) return;
      // Otra cuenta (o sin cuenta): el caché del usuario anterior no debe
      // sobrevivir, mismo motivo que en login/logout (#291). Si solo cambió el
      // token de la misma cuenta, el caché sigue siendo válido.
      if (prev.user?.id !== next.user?.id) queryClient.clear();
      setAuth(next);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        isAuthenticated: !!token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}