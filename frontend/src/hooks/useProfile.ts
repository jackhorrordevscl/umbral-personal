import { useQuery } from '@tanstack/react-query';
import api from '../api/client';

export interface Profile {
  id: string;
  email: string;
  name: string;
  mfaEnabled: boolean;
  createdAt: string;
  pendingEmail: string | null;
  // Issue #124: solo el profesional autorizado puede emitir códigos de
  // invitación para el registro público (POST /auth/invitations) -- ver
  // sección "Generar invitación" en SecurityPage.
  canInvite: boolean;
  // null si nunca subió una foto de perfil. El frontend la usa para armar
  // una URL cache-busted (`/profile/avatar?v=<avatarUpdatedAt>`) y evitar
  // servir la foto vieja cacheada por el browser tras un re-upload -- ver
  // AvatarCard en ProfilePage.tsx.
  avatarUpdatedAt: string | null;
}

// PR2a (session-calendar-view, design.md "Decision: useProfile react-query
// hook shared by both split pages"): antes SettingsPage hacía su propio
// GET /profile en un useEffect para alimentar tanto los datos de cuenta
// (nombre/email/pendingEmail) como mfaEnabled -- al separar la pantalla en
// ProfilePage y SecurityPage eso se habría convertido en dos fetches
// independientes al mismo endpoint. Este hook centraliza la llamada bajo
// react-query (queryKey: ['profile']) para que ambas páginas compartan la
// misma respuesta cacheada, deduplicada bajo el staleTime global de 30s ya
// configurado en App.tsx (mismo patrón que usePatients/useConsultations).
export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: async (): Promise<Profile> => {
      const res = await api.get('/profile');
      return res.data;
    },
  });
}
