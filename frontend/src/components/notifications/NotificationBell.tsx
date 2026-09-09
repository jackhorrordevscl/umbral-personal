import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { Bell } from 'lucide-react';
import NotificationList from './NotificationList';
import { FOCUSABLE_SELECTOR } from '../ui/Modal';
import type { Notification } from '../../types/notification';
import {
  useMarkNotificationRead,
  useNotificationsList,
  useUnreadNotificationsCount,
} from '../../hooks/useNotifications';

// sdd/session-reminders PR 3 (tasks 7.1/7.3): campanita con badge de no
// leídas (polling, task 7.1) + panel desplegable con la lista (task 7.2).
// design.md no especifica la UI del frontend en detalle (solo el contrato
// REST) -- se eligió un dropdown en vez de una página dedicada porque no
// hay ruta de notificaciones en el plan de archivos del design (solo
// "frontend/src/** -- Bell badge + notification list"), y el mismo patrón
// de overlay + panel ya existe para el sidebar móvil en Layout.tsx.
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: unread } = useUnreadNotificationsCount();
  const {
    data: notifications = [],
    isLoading,
    isError,
  } = useNotificationsList(open);
  const markReadMutation = useMarkNotificationRead();

  const unreadCount = unread?.count ?? 0;

  const handleOpen = (notification: Notification) => {
    if (!notification.readAt) markReadMutation.mutate(notification.id);
    setOpen(false);
    if (notification.linkPath) navigate(notification.linkPath);
  };

  // #121: mismo focus trap que <Modal> (Modal.tsx), pero aplicado a mano
  // porque este panel es un dropdown anclado al botón, no el overlay
  // centrado que <Modal> renderiza. A diferencia de Modal, el contenido
  // llega async (useNotificationsList) -- si enfocáramos apenas open pasa a
  // true, el panel todavía no tiene nada enfocable (loading). Se espera a
  // que termine de cargar y se enfoca una sola vez por apertura.
  const hasFocusedOnOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      hasFocusedOnOpenRef.current = false;
      return;
    }
    if (isLoading || hasFocusedOnOpenRef.current) return;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    hasFocusedOnOpenRef.current = true;
  }, [open, isLoading]);

  const handlePanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;

    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative text-slate-500 hover:text-slate-900 transition-colors p-1"
        aria-label={
          unreadCount > 0
            ? `Notificaciones, ${unreadCount} sin leer`
            : 'Notificaciones'
        }
        aria-expanded={open}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center font-semibold"
            data-testid="notification-badge"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Overlay para cerrar al hacer click afuera -- mismo patrón que
              el overlay del sidebar móvil en Layout.tsx. */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Notificaciones"
            onKeyDown={handlePanelKeyDown}
            className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-100 z-40 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Notificaciones</h3>
            </div>
            <NotificationList
              notifications={notifications}
              isLoading={isLoading}
              isError={isError}
              onOpen={handleOpen}
            />
          </div>
        </>
      )}
    </div>
  );
}
