import type { PaymentSummary } from '../../types/patient';

interface PaymentStatusBadgeProps {
  payment: PaymentSummary | null;
}

type BadgeKey = 'PENDING' | 'PAID' | 'LATE' | 'CANCELLED' | 'SKIPPED_NO_EMAIL';

const BADGE_STYLES: Record<BadgeKey, string> = {
  PENDING: 'bg-blue-50 text-blue-600',
  PAID: 'bg-emerald-50 text-emerald-700',
  LATE: 'bg-red-50 text-red-600',
  CANCELLED: 'bg-slate-100 text-slate-500',
  // design.md "Link delivery has an explicit persisted state and never
  // blocks the charge" -- SKIPPED_NO_EMAIL es un estado terapeuta-visible
  // distinto de "pendiente de pago" (mismo status PENDING, distinto matiz
  // visual): el cargo existe y es cobrable, pero el paciente nunca recibió
  // el link automáticamente.
  SKIPPED_NO_EMAIL: 'bg-amber-50 text-amber-700',
};

const BADGE_LABELS: Record<BadgeKey, string> = {
  PENDING: 'Cobro pendiente',
  PAID: 'Pagado',
  LATE: 'Cobro atrasado',
  CANCELLED: 'Cobro cancelado',
  SKIPPED_NO_EMAIL: 'Link no enviado',
};

// sdd/online-payment-integration PR 3 (T9.5, ConsultationsPage.tsx:318):
// insertado en la misma fila de chips que sessionType, justo después --
// null (sin cargo asociado a esta sesión, p. ej. terapeuta sin cuenta
// conectada) no renderiza nada (T10.5).
export default function PaymentStatusBadge({ payment }: PaymentStatusBadgeProps) {
  if (!payment) return null;

  const key: BadgeKey =
    payment.status === 'PENDING' && payment.linkDelivery === 'SKIPPED_NO_EMAIL'
      ? 'SKIPPED_NO_EMAIL'
      : payment.status;

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${BADGE_STYLES[key]}`}>
      {BADGE_LABELS[key]}
    </span>
  );
}
