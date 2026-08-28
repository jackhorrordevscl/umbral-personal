import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Calendar, CalendarCheck, CalendarOff } from 'lucide-react';
import api from '../../api/client';

interface CalendarConnectionStatus {
  status: 'PENDING' | 'CONNECTED' | 'DISCONNECTED';
}

const STATUS_LABELS: Record<CalendarConnectionStatus['status'], string> = {
  CONNECTED: 'Google Calendar conectado',
  DISCONNECTED: 'Google Calendar desconectado',
  PENDING: 'Google Calendar sin configurar',
};

// session-calendar Req: Google Calendar Status Badge -- solo lectura del
// estado (GET /calendar-integration/status, mismo endpoint que ya consume
// SecurityPage), enlaza a Seguridad; ningún control de conectar/desconectar
// vive acá (esos quedan solo en el panel completo de SecurityPage,
// tasks.md 5.7).
export default function CalendarSyncBadge() {
  const { data } = useQuery({
    queryKey: ['calendar-integration-status'],
    queryFn: async (): Promise<CalendarConnectionStatus> => {
      const res = await api.get('/calendar-integration/status');
      return res.data;
    },
  });

  const status = data?.status ?? 'PENDING';
  const Icon = status === 'CONNECTED' ? CalendarCheck : status === 'DISCONNECTED' ? CalendarOff : Calendar;

  return (
    <Link
      to="/security"
      data-testid="calendar-sync-badge"
      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
      title="Ver estado de Google Calendar en Seguridad"
    >
      <Icon size={14} />
      {STATUS_LABELS[status]}
    </Link>
  );
}
