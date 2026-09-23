import Modal from '../ui/Modal';
import type { Notification } from '../../types/notification';
import { formatChileDateTime } from '../../utils/datetime';

interface NotificationDetailModalProps {
  notification: Notification;
  onClose: () => void;
  onNavigate: (linkPath: string) => void;
}

// El panel de NotificationBell trunca título (truncate) y cuerpo
// (line-clamp-2) para que el dropdown no se agrande con cada notificación --
// este modal es donde el texto completo, sin recortar, se puede leer.
export default function NotificationDetailModal({
  notification,
  onClose,
  onNavigate,
}: NotificationDetailModalProps) {
  return (
    <Modal onClose={onClose} labelledBy="notification-detail-title" className="max-w-md p-6">
      <div className="flex items-start justify-between mb-3 gap-4">
        <h3 id="notification-detail-title" className="font-display text-lg text-slate-900">
          {notification.title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 shrink-0"
          aria-label="Cerrar"
        >
          ×
        </button>
      </div>
      <p className="text-sm text-slate-700 whitespace-pre-wrap mb-3">{notification.body}</p>
      <p className="text-xs text-slate-500 mb-5">{formatChileDateTime(notification.createdAt)}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary text-sm">
          Cerrar
        </button>
        {notification.linkPath && (
          <button
            type="button"
            onClick={() => onNavigate(notification.linkPath!)}
            className="btn-primary text-sm"
          >
            Ir ahora
          </button>
        )}
      </div>
    </Modal>
  );
}
