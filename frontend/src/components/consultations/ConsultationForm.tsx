import ErrorBanner from '../ui/ErrorBanner';
import FormField from '../ui/FormField';
import { usePatients } from '../../hooks/usePatients';
import { useCreateConsultation } from '../../hooks/useConsultations';
import { useUploadPatientDocument } from '../../hooks/usePatientDocuments';
import type { Patient } from '../../types/patient';
import { buildLocalISO } from '../../utils/datetime';
import { getApiErrorMessage } from '../../utils/api-error';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

// Sugerencia de usuarios: muchos terapeutas ya llevan su propio registro de
// sesión (Word/PDF) y quieren adjuntarlo tal cual, en vez de reescribir todo
// en los campos de texto. Se sube atado a esta consulta (consultationGroupId,
// ver migración add_consultation_summary_document) reusando el módulo de
// documentos existente (cifrado + validación real de contenido).
const ALLOWED_SUMMARY_EXTENSIONS = ['.pdf', '.doc', '.docx'];

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
  const [summaryFile, setSummaryFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // La sesión clínica ya se guardó pero el adjunto falló -- se retiene el
  // groupId para poder reintentar SOLO la subida sin duplicar la consulta
  // (mismo criterio que emitCalendarSync/emitPaymentCharge en el backend:
  // lo accesorio nunca revierte ni bloquea lo clínico).
  const [pendingUploadGroupId, setPendingUploadGroupId] = useState<string | null>(null);

  const { data: patients = [] } = usePatients();
  const createMutation = useCreateConsultation();
  const uploadMutation = useUploadPatientDocument(form.patientId || undefined);

  const runUpload = async (groupId: string) => {
    if (!summaryFile) return;
    try {
      await uploadMutation.mutateAsync({
        file: summaryFile,
        type: 'SESSION_SUMMARY',
        consultationGroupId: groupId,
      });
      setPendingUploadGroupId(null);
    } catch (uploadErr) {
      setPendingUploadGroupId(groupId);
      setFormError(getApiErrorMessage(uploadErr, 'La sesión se guardó, pero no se pudo subir el archivo adjunto.'));
      return;
    }
    setForm(emptyForm);
    setSummaryFile(null);
    setFormError('');
    onSuccess();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // El registro clínico ya se guardó, solo falta reintentar el adjunto.
    if (pendingUploadGroupId) {
      await runUpload(pendingUploadGroupId);
      return;
    }

    if (!form.patientId) { setFormError('Selecciona un paciente'); return; }
    if (!form.sessionDate) { setFormError('La fecha de sesión es obligatoria'); return; }
    if (!form.consultReason.trim()) { setFormError('El motivo de consulta es obligatorio'); return; }
    if (!form.intervention.trim()) { setFormError('La intervención es obligatoria'); return; }
    setFormError('');

    try {
      const created = await createMutation.mutateAsync({
        patientId: form.patientId,
        sessionDate: buildLocalISO(form.sessionDate, form.sessionTime),
        consultReason: form.consultReason,
        intervention: form.intervention,
        agreements: form.agreements,
        nextSessionDate: form.nextSessionDate
          ? buildLocalISO(form.nextSessionDate, form.nextSessionTime)
          : undefined,
        sessionType: form.sessionType,
      });

      if (summaryFile) {
        await runUpload(created.groupId);
        return;
      }

      setForm(emptyForm);
      setFormError('');
      onSuccess();
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Error al guardar sesión'));
    }
  };

  if (pendingUploadGroupId) {
    return (
      <form onSubmit={handleSubmit}>
        <p className="text-sm text-slate-600 mb-4">
          La sesión ya quedó guardada. Solo falta reintentar la subida del archivo adjunto.
        </p>
        <p className="text-sm font-medium text-slate-800 mb-4">{summaryFile?.name}</p>
        {formError && <ErrorBanner icon message={formError} className="mb-4" />}
        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={uploadMutation.isPending}>
            {uploadMutation.isPending ? 'Subiendo...' : 'Reintentar subida'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setPendingUploadGroupId(null);
              setSummaryFile(null);
              setForm(emptyForm);
              setFormError('');
              onSuccess();
            }}
          >
            Omitir y cerrar
          </button>
        </div>
      </form>
    );
  }

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
        <FormField id="consult-summaryFile" label="Registro de sesión propio (opcional)" className="md:col-span-2">
          <div
            className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center cursor-pointer hover:border-sage-300 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            {summaryFile ? (
              <p className="text-sm text-sage-600 font-medium">{summaryFile.name}</p>
            ) : (
              <>
                <Upload size={20} className="text-slate-300 mx-auto mb-1" />
                <p className="text-xs text-slate-500">
                  Adjuntá tu propio registro de la sesión (PDF o Word) en vez de completar los campos de arriba
                </p>
              </>
            )}
            <input
              id="consult-summaryFile"
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_SUMMARY_EXTENSIONS.join(',')}
              className="hidden"
              onChange={e => setSummaryFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {summaryFile && (
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-600 mt-1"
              onClick={() => { setSummaryFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
            >
              Quitar archivo
            </button>
          )}
        </FormField>
      </div>
      {formError && <ErrorBanner icon message={formError} className="mt-4" />}
      <div className="flex gap-3 mt-6">
        <button type="submit" className="btn-primary" disabled={createMutation.isPending || uploadMutation.isPending}>
          {createMutation.isPending ? 'Guardando...' : uploadMutation.isPending ? 'Subiendo adjunto...' : 'Guardar sesión'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">Cancelar</button>
      </div>
    </form>
  );
}
