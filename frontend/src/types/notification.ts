// sdd/session-reminders PR 3: tipos del frontend para el modelo genérico de
// notificaciones definido en notifications.service.ts (PR 1). `type` queda
// como string (no union literal) a propósito -- el backend documenta que
// slices futuros (google-calendar-sync, etc.) agregan miembros al enum sin
// que el frontend necesite un cambio de forma.
export type NotificationType = 'SESSION_REMINDER' | (string & {});

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  linkPath: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface UnreadCount {
  count: number;
}
