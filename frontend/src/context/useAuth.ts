import { createContext, useContext } from 'react';

export interface User {
  id: string;
  email: string;
  role: string;
  name: string;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: (options?: { expired?: boolean }) => void;
  isAuthenticated: boolean;
  /** false si la sesión terminó por logout voluntario o desde otra pestaña. */
  canRestoreRoute: boolean;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
