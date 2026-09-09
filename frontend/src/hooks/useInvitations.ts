import { useMutation } from '@tanstack/react-query';
import api from '../api/client';

export interface InvitationCode {
  code: string;
  expiresAt: string;
}

// Issue #124: mismo patrón react-query que useConnectCalendar (POST sin
// body, sin invalidación de queries -- el código generado no forma parte
// de ningún estado cacheado, solo se muestra una vez en SecurityPage). Solo
// el profesional autorizado puede llamar a este endpoint (canInvite, ver
// useProfile); si no lo es, el backend responde 403.
export function useCreateInvitation() {
  return useMutation({
    mutationFn: () =>
      api.post<InvitationCode>('/auth/invitations').then((r) => r.data),
  });
}
