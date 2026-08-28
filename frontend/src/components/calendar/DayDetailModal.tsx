import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import Modal from '../ui/Modal';
import ConsultationForm from '../consultations/ConsultationForm';
import { formatChileTime } from '../../utils/datetime';
import type { CalendarSession } from '../../api/consultations';

interface DayDetailModalProps {
  /** Día calendario "YYYY-MM-DD" seleccionado. */
  day: string;
  sessions: CalendarSession[];
  onClose: () => void;
}

const SESSION_TYPE_LABELS: Record<CalendarSession['sessionType'], string> = {
  IN_PERSON: 'Presencial',
  TELEMED: 'Telemedicina',
};

// session-calendar Req: Read-Only Day Detail Modal -- lista de solo lectura
// (sin editar/cancelar, esas acciones quedan en Consultas) + entrada al
// formulario clínico existente ya usado en ConsultationsPage (extraído en
// PR3), reutilizando sus props initialDate/initialTime (tasks.md 5.6).
export default function DayDetailModal({ day, sessions, onClose }: DayDetailModalProps) {
  const [showForm, setShowForm] = useState(false);

  return (
    <Modal onClose={onClose} labelledBy="day-detail-title" className="max-w-lg p-6 max-h-[90vh] overflow-auto">
      <div className="flex items-start justify-between mb-4">
        <h3 id="day-detail-title" className="font-display text-xl text-slate-900">
          {day}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600"
          aria-label="Cerrar"
        >
          ×
        </button>
      </div>

      {showForm ? (
        <ConsultationForm
          initialDate={day}
          initialTime="09:00"
          onSuccess={onClose}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <>
          {sessions.length === 0 ? (
            <p className="text-sm text-slate-500 mb-4">Sin sesiones este día.</p>
          ) : (
            <ul className="space-y-2 mb-4">
              {sessions.map((s) => (
                <li key={s.id} className="border border-slate-100 rounded-lg p-3">
                  <p className="text-sm font-medium text-slate-800">{s.patientName}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {formatChileTime(s.sessionDate)} · {SESSION_TYPE_LABELS[s.sessionType]}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="btn-primary flex items-center gap-2"
          >
            <CalendarPlus size={16} />
            Agendar sesión
          </button>
        </>
      )}
    </Modal>
  );
}
