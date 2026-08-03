import { useState } from 'react';
import type { ReactNode } from 'react';
import { AuthContext, type User } from './useAuth';

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

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setAuth({ token: newToken, user: newUser });
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setAuth({ token: null, user: null });
  };

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