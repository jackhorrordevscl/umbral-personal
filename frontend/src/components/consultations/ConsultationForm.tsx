import ErrorBanner from '../ui/ErrorBanner';
import FormField from '../ui/FormField';
import { usePatients } from '../../hooks/usePatients';
import { useCreateConsultation } from '../../hooks/useConsultations';
import type { Patient } from '../../types/patient';
import { buildLocalISO } from '../../utils/datetime';
import { getApiErrorMessage } from '../../utils/api-error';
import { useState } from 'react';

interface ConsultationFormProps {
  /** Fecha de sesión precargada (ej. desde el día seleccionado en el calendario). */
  initialDate?: string;
  /** Hora de sesión precargada (ej. desde el día seleccionado en el calendario). */
  initialTime?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

// Extraído de ConsultationsPage (session-calendar-view PR3) para reutilizarse
// tanto en la página de Consultas como en el modal de detalle de día del
// calendario (PR4). Sin cambio de comportamiento respecto al form inline
// original: mismos ids de campo, mismas validaciones, mismo flujo de envío.
export default function ConsultationForm({
  initialDate,
  initialTime,
  onSuccess,
  onCancel,
}: ConsultationFormProps) {
  const emptyForm = {
    patientId: '', sessionDate: initialDate ?? '', sessionTime: initialTime ?? '09:00',
    consultReason: '', intervention: '', agreements: '',
    nextSessionDate: '', nextSessionTime: '09:00',
    sessionType: 'IN_PERSON',
  };

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');

  const { data: patients = [] } = usePatients();
  const createMutation = useCreateConsultation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.patientId) { setFormError('Selecciona un paciente'); return; }
    if (!form.sessionDate) { setFormError('La fecha de sesión es obligatoria'); return; }
    if (!form.consultReason.trim()) { setFormError('El motivo de consulta es obligatorio'); return; }
    if (!form.intervention.trim()) { setFormError('La intervención es obligatoria'); return; }
    setFormError('');
    createMutation.mutate(
      {
        patientId: form.patientId,
        sessionDate: buildLocalISO(form.sessionDate, form.sessionTime),
        consultReason: form.consultReason,
        intervention: form.intervention,
        agreements: form.agreements,
        nextSessionDate: form.nextSessionDate
          ? buildLocalISO(form.nextSessionDate, form.nextSessionTime)
          : undefined,
        sessionType: form.sessionType,
      },
      {
        onSuccess: () => {
          setForm(emptyForm);
          setFormError('');
          onSuccess();
        },
        onError: (err: unknown) => {
          setFormError(getApiErrorMessage(err, 'Error al guardar sesión'));
        },
      },
    );
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField id="consult-patientId" label="Paciente" required className="md:col-span-2">
          <select id="consult-patientId" className="input-field" value={form.patientId}
            onChange={e => setForm({ ...form, patientId: e.target.value })}>
            <option value="">Seleccionar paciente...</option>
            {patients.map((p: Patient) => (
              <option key={p.id} value={p.id}>{p.fullName} — {p.rut}</option>
            ))}
          </select>
        </FormField>
        <FormField id="consult-sessionDate" label="Fecha de sesión" required>
          <input id="consult-sessionDate" type="date" className="input-field" value={form.sessionDate}
            onChange={e => setForm({ ...form, sessionDate: e.target.value })} />
        </FormField>
        <FormField id="consult-sessionTime" label="Hora de sesión" required>
          <input id="consult-sessionTime" type="time" className="input-field" value={form.sessionTime}
            onChange={e => setForm({ ...form, sessionTime: e.target.value })} />
        </FormField>
        <FormField id="consult-sessionType" label="Tipo de sesión">
          <select id="consult-sessionType" className="input-field" value={form.sessionType}
            onChange={e => setForm({ ...form, sessionType: e.target.value })}>
            <option value="IN_PERSON">Presencial</option>
            <option value="TELEMED">Telemedicina</option>
          </select>
        </FormField>
        <FormField id="consult-consultReason" label="Motivo de consulta" required className="md:col-span-2">
          <textarea id="consult-consultReason" rows={2} className="input-field resize-none text-slate-800 placeholder-slate-400"
            placeholder="Describe el motivo principal de la sesión..."
            value={form.consultReason}
            onChange={e => setForm({ ...form, consultReason: e.target.value })} />
        </FormField>
        <FormField id="consult-intervention" label="Intervención realizada / Registro de evolución clínica" required className="md:col-span-2">
          <textarea id="consult-intervention" rows={3} className="input-field resize-none text-slate-800 placeholder-slate-400"
            placeholder="Describe las técnicas e intervenciones realizadas durante la sesión..."
            value={form.intervention}
            onChange={e => setForm({ ...form, intervention: e.target.value })} />
        </FormField>
        <FormField id="consult-agreements" label="Tareas y acuerdos" className="md:col-span-2">
          <textarea id="consult-agreements" rows={2} className="input-field resize-none text-slate-800 placeholder-slate-400"
            placeholder="Tareas asignadas, acuerdos terapéuticos, compromisos del paciente..."
            value={form.agreements}
            onChange={e => setForm({ ...form, agreements: e.target.value })} />
        </FormField>
        <FormField id="consult-nextSessionDate" label="Próxima sesión — Fecha">
          <input id="consult-nextSessionDate" type="date" className="input-field" value={form.nextSessionDate}
            onChange={e => setForm({ ...form, nextSessionDate: e.target.value })} />
        </FormField>
        <FormField id="consult-nextSessionTime" label="Próxima sesión — Hora">
          <input id="consult-nextSessionTime" type="time" className="input-field" value={form.nextSessionTime}
            onChange={e => setForm({ ...form, nextSessionTime: e.target.value })} />
        </FormField>
      </div>
      {formError && <ErrorBanner icon message={formError} className="mt-4" />}
      <div className="flex gap-3 mt-6">
        <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
          {createMutation.isPending ? 'Guardando...' : 'Guardar sesión'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">Cancelar</button>
      </div>
    </form>
  );
}
