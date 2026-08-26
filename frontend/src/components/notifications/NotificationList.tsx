import { BellOff } from 'lucide-react';
import type { Notification } from '../../types/notification';
import { formatChileDateTime } from '../../utils/datetime';

interface NotificationListProps {
  notifications: Notification[];
  isLoading: boolean;
  isError: boolean;
  onMarkRead: (id: string) => void;
}

// sdd/session-reminders PR 3 (task 7.2): componente presentacional --
// misma separación datos/presentación que PatientForm (PatientsPage arma
// los hooks/mutations, PatientForm solo recibe props). El contenedor es
// NotificationBell.
export default function NotificationList({
  notifications,
  isLoading,
  isError,
  onMarkRead,
}: NotificationListProps) {
  if (isLoading) {
    return (
      <p className="text-slate-500 text-sm text-center py-6">Cargando notificaciones...</p>
    );
  }

  if (isError) {
    return (
      <p className="text-red-600 text-sm text-center py-6">
        No se pudieron cargar las notificaciones.
      </p>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
        <BellOff size={22} />
        <p className="text-sm">No tienes notificaciones.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100 max-h-96 overflow-auto" role="list">
      {notifications.map((notification) => {
        const isUnread = !notification.readAt;
        return (
          <li key={notification.id}>
            <button
              type="button"
              onClick={() => isUnread && onMarkRead(notification.id)}
              className={`w-full text-left px-4 py-3 flex flex-col gap-1 transition-colors ${
                isUnread ? 'bg-sage-50 hover:bg-sage-100' : 'bg-white hover:bg-cream-50'
              }`}
              aria-label={
                isUnread
                  ? `Marcar como leída: ${notification.title}`
                  : notification.title
              }
            >
              <div className="flex items-center justify-between gap-2">
                <p
                  className={`text-sm truncate ${
                    isUnread ? 'font-semibold text-slate-900' : 'font-medium text-slate-600'
                  }`}
                >
                  {notification.title}
                </p>
                {isUnread && (
                  <span
                    className="shrink-0 w-2 h-2 rounded-full bg-sage-600"
                    aria-hidden="true"
                  />
                )}
              </div>
              <p className="text-xs text-slate-500 line-clamp-2">{notification.body}</p>
              <p className="text-[11px] text-slate-400">
                {formatChileDateTime(notification.createdAt)}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
