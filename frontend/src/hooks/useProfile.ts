import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  // issue #155: mostrados en la autoagenda pública (PublicBookingPage.tsx)
  // vía GET /public/therapists/:id/profile -- null si el terapeuta nunca los
  // completó, igual criterio que avatarUpdatedAt.
  bio: string | null;
  specialty: string | null;
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

// Issue #202: mutaciones de PATCH /profile y del avatar, antes con estado
// saving/error hecho a mano en ProfilePage. Cada formulario decide qué hacer
// con la respuesta (onSuccess en mutate) y lee isPending/error de la mutación.
export type UpdateProfilePayload = Partial<{
  name: string;
  bio: string;
  specialty: string;
  email: string;
  password: string;
  currentPassword: string;
}>;

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (payload: UpdateProfilePayload) =>
      api.patch<Partial<Profile>>('/profile', payload).then((r) => r.data),
  });
}

// Mismo patrón que uploadPatientDocument en api/documents.ts: el cliente
// axios trae `Content-Type: application/json` por defecto, así que hay que
// pisarlo a mano en cada upload -- sin este override, axios manda el FormData
// sin boundary y @UploadedFile() del backend nunca ve el archivo.
export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api
        .post<{ avatarUpdatedAt: string }>('/profile/avatar', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data);
    },
    onSuccess: (data) => {
      queryClient.setQueryData<Profile | undefined>(['profile'], (prev) =>
        prev ? { ...prev, avatarUpdatedAt: data.avatarUpdatedAt } : prev,
      );
    },
  });
}

export function useDeleteAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('/profile/avatar'),
    onSuccess: () => {
      queryClient.setQueryData<Profile | undefined>(['profile'], (prev) =>
        prev ? { ...prev, avatarUpdatedAt: null } : prev,
      );
    },
  });
}
