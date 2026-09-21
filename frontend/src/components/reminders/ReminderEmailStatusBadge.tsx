import type { ReminderEmailStatus } from '../../types/patient';

interface ReminderEmailStatusBadgeProps {
  status: ReminderEmailStatus | null;
}

type BadgeKey = 'FAILED' | 'SENT' | 'DELIVERED' | 'OPENED';

const BADGE_STYLES: Record<BadgeKey, string> = {
  FAILED: 'bg-red-50 text-red-600',
  SENT: 'bg-slate-100 text-slate-500',
  DELIVERED: 'bg-emerald-50 text-emerald-700',
  OPENED: 'bg-emerald-50 text-emerald-700',
};

const BADGE_LABELS: Record<BadgeKey, string> = {
  FAILED: 'Recordatorio no enviado',
  SENT: 'Recordatorio enviado',
  DELIVERED: 'Entregado',
  OPENED: 'Abierto',
};

// issue #163: mismo lugar visual que PaymentStatusBadge (ConsultationsPage,
// misma fila de chips), mismo criterio de "sin dato asociado no renderiza
// nada" -- acá "sin dato" es no haber despachado nunca un recordatorio por
// email para esta sesión (reminderEmailStatus null).
//
// PENDING/SKIPPED tampoco renderizan chip: son estados transitorios/no-op
// del dispatcher (ver RemindersService.claimAndDispatch) sin valor
// informativo para el terapeuta en esta vista -- a diferencia de PAYMENT
// donde cada status tiene un chip visible, acá el objetivo es señalizar
// solo fallas y confirmaciones de entrega/apertura.
export default function ReminderEmailStatusBadge({ status }: ReminderEmailStatusBadgeProps) {
  if (!status) return null;

  let key: BadgeKey | null;
  if (status.status === 'FAILED') {
    key = 'FAILED';
  } else if (status.status === 'PENDING' || status.status === 'SKIPPED') {
    key = null;
  } else if (status.openedAt) {
    key = 'OPENED';
  } else if (status.deliveredAt) {
    key = 'DELIVERED';
  } else {
    key = 'SENT';
  }

  if (!key) return null;

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${BADGE_STYLES[key]}`}>
      {BADGE_LABELS[key]}
    </span>
  );
}
