import { useState } from 'react';
import { ClipboardPlus, Search, X, ChevronDown, ChevronUp, Pencil, AlertCircle } from 'lucide-react';
import Modal from '../components/ui/Modal';
import { usePatients } from '../hooks/usePatients';
import { useConsultations, useCreateConsultation, useCorrectConsultation } from '../hooks/useConsultations';
import type { Consultation, ConsultationHistory, Patient } from '../types/patient';
import { buildLocalISO, formatChileDateTime, formatChileDate } from '../utils/datetime';
import { normalizeRut } from '../utils/rut';
import { getApiErrorMessage } from '../utils/api-error';

const emptyForm = {
  patientId: '', sessionDate: '', sessionTime: '09:00',
  consultReason: '', intervention: '', agreements: '',
  nextSessionDate: '', nextSessionTime: '09:00',
  sessionType: 'IN_PERSON',
};

export default function ConsultationsPage() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [showPatientList, setShowPatientList] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [editingConsultation, setEditingConsultation] = useState<Consultation | null>(null);
  const [editError, setEditError] = useState('');
  const [editForm, setEditForm] = useState({
    sessionDate: '', sessionTime: '09:00',
    consultReason: '', intervention: '', agreements: '',
    nextSessionDate: '', nextSessionTime: '09:00',
    sessionType: 'IN_PERSON',
  });
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());

  const { data: patients = [], isError: patientsError } = usePatients();

  const { data: consultations = [], isError: consultationsError } =
    useConsultations(selectedPatientId || undefined);

  const createMutation = useCreateConsultation();
  const correctMutation = useCorrectConsultation();

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
          setShowForm(false);
          setForm(emptyForm);
          setFormError('');
        },
        onError: (err: unknown) => {
          setFormError(getApiErrorMessage(err, 'Error al guardar sesión'));
        },
      },
    );
  };

  const handleEditOpen = (c: Consultation) => {
    const sd = new Date(c.sessionDate);
    const nd = c.nextSessionDate ? new Date(c.nextSessionDate) : null;
    const toLocalDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    const toLocalTime = (d: Date) => d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santiago' });
    setEditForm({
      sessionDate: toLocalDate(sd),
      sessionTime: toLocalTime(sd),
      consultReason: c.consultReason,
      intervention: c.intervention,
      agreements: c.agreements ?? '',
      nextSessionDate: nd ? toLocalDate(nd) : '',
      nextSessionTime: nd ? toLocalTime(nd) : '09:00',
      sessionType: c.sessionType,
    });
    setEditingConsultation(c);
    setEditError('');
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingConsultation) return;
    correctMutation.mutate(
      {
        id: editingConsultation.id,
        data: {
          sessionDate: buildLocalISO(editForm.sessionDate, editForm.sessionTime),
          consultReason: editForm.consultReason,
          intervention: editForm.intervention,
          agreements: editForm.agreements,
          nextSessionDate: editForm.nextSessionDate
            ? buildLocalISO(editForm.nextSessionDate, editForm.nextSessionTime)
            : undefined,
          sessionType: editForm.sessionType,
        },
      },
      {
        onSuccess: () => {
          setEditingConsultation(null);
          setEditError('');
        },
        onError: (err: unknown) => {
          // Issue #41: banner rojo del propio formulario en vez de alert()
          // nativo, mismo patrón que formError arriba.
          setEditError(getApiErrorMessage(err, 'Error al corregir sesión'));
        },
      },
    );
  };

  const toggleHistory = (id: string) => {
    setExpandedHistory(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredPatients = patients.filter((p: Patient) =>
    p.fullName.toLowerCase().includes(search.toLowerCase()) ||
    normalizeRut(p.rut).includes(normalizeRut(search))
  );

  const selectedPatient = patients.find((p: Patient) => p.id === selectedPatientId);

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div>
          <h2 className="font-display text-2xl md:text-3xl text-slate-900">Consultas</h2>
          <p className="text-slate-500 text-sm mt-1">Registro clínico de sesiones</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
          <ClipboardPlus size={16} />
          <span className="hidden sm:inline">Nueva consulta</span>
          <span className="sm:hidden">Nueva</span>
        </button>
      </div>

      {(patientsError || consultationsError) && (
        <div className="mb-6 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={14} className="text-red-500 shrink-0" />
          <p className="text-red-600 text-sm">
            No se pudieron cargar {patientsError ? 'los pacientes' : 'las consultas'}. Reintenta más tarde.
          </p>
        </div>
      )}

      {/* Formulario nueva consulta */}
      {showForm && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-xl text-slate-900">Registrar Sesión</h3>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar">
              <X size={20} />
            </button>
          </div>
          <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="consult-patientId" className="block text-xs font-medium text-slate-600 mb-1">Paciente *</label>
              <select id="consult-patientId" className="input-field" value={form.patientId}
                onChange={e => setForm({ ...form, patientId: e.target.value })}>
                <option value="">Seleccionar paciente...</option>
                {patients.map((p: Patient) => (
                  <option key={p.id} value={p.id}>{p.fullName} — {p.rut}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="consult-sessionDate" className="block text-xs font-medium text-slate-600 mb-1">Fecha de sesión *</label>
              <input id="consult-sessionDate" type="date" className="input-field" value={form.sessionDate}
                onChange={e => setForm({ ...form, sessionDate: e.target.value })} />
            </div>
            <div>
              <label htmlFor="consult-sessionTime" className="block text-xs font-medium text-slate-600 mb-1">Hora de sesión *</label>
              <input id="consult-sessionTime" type="time" className="input-field" value={form.sessionTime}
                onChange={e => setForm({ ...form, sessionTime: e.target.value })} />
            </div>
            <div>
              <label htmlFor="consult-sessionType" className="block text-xs font-medium text-slate-600 mb-1">Tipo de sesión</label>
              <select id="consult-sessionType" className="input-field" value={form.sessionType}
                onChange={e => setForm({ ...form, sessionType: e.target.value })}>
                <option value="IN_PERSON">Presencial</option>
                <option value="TELEMED">Telemedicina</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="consult-consultReason" className="block text-xs font-medium text-slate-600 mb-1">Motivo de consulta *</label>
              <textarea id="consult-consultReason" rows={2} className="input-field resize-none text-slate-800 placeholder-slate-400"
                placeholder="Describe el motivo principal de la sesión..."
                value={form.consultReason}
                onChange={e => setForm({ ...form, consultReason: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="consult-intervention" className="block text-xs font-medium text-slate-600 mb-1">Intervención realizada / Registro de evolución clínica *</label>
              <textarea id="consult-intervention" rows={3} className="input-field resize-none text-slate-800 placeholder-slate-400"
                placeholder="Describe las técnicas e intervenciones realizadas durante la sesión..."
                value={form.intervention}
                onChange={e => setForm({ ...form, intervention: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="consult-agreements" className="block text-xs font-medium text-slate-600 mb-1">Tareas y acuerdos</label>
              <textarea id="consult-agreements" rows={2} className="input-field resize-none text-slate-800 placeholder-slate-400"
                placeholder="Tareas asignadas, acuerdos terapéuticos, compromisos del paciente..."
                value={form.agreements}
                onChange={e => setForm({ ...form, agreements: e.target.value })} />
            </div>
            <div>
              <label htmlFor="consult-nextSessionDate" className="block text-xs font-medium text-slate-600 mb-1">Próxima sesión — Fecha</label>
              <input id="consult-nextSessionDate" type="date" className="input-field" value={form.nextSessionDate}
                onChange={e => setForm({ ...form, nextSessionDate: e.target.value })} />
            </div>
            <div>
              <label htmlFor="consult-nextSessionTime" className="block text-xs font-medium text-slate-600 mb-1">Próxima sesión — Hora</label>
              <input id="consult-nextSessionTime" type="time" className="input-field" value={form.nextSessionTime}
                onChange={e => setForm({ ...form, nextSessionTime: e.target.value })} />
            </div>
          </div>
          {formError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-4 flex items-center gap-2">
              <AlertCircle size={14} className="text-red-500 shrink-0" />
              <p className="text-red-600 text-sm">{formError}</p>
            </div>
          )}
          <div className="flex gap-3 mt-6">
            <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Guardando...' : 'Guardar sesión'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
          </div>
          </form>
        </div>
      )}

      {/* Modal edición */}
      {editingConsultation && (
        <Modal
          onClose={() => { setEditingConsultation(null); setEditError(''); }}
          labelledBy="correct-consultation-title"
          className="max-w-2xl p-6 max-h-[90vh] overflow-auto"
        >
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 id="correct-consultation-title" className="font-display text-xl text-slate-900">
                  Corregir Sesión
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  La versión actual quedará guardada en el historial de esta sesión.
                </p>
              </div>
              <button
                onClick={() => { setEditingConsultation(null); setEditError(''); }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex gap-2">
              <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                Por normativa clínica las sesiones no se eliminan ni sobreescriben. Esta corrección actualiza el registro y guarda un snapshot de la versión anterior para trazabilidad.
              </p>
            </div>
            <form onSubmit={handleEditSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="correct-sessionDate" className="block text-xs font-medium text-slate-600 mb-1">Fecha de sesión</label>
                <input id="correct-sessionDate" type="date" className="input-field" value={editForm.sessionDate}
                  onChange={e => setEditForm({ ...editForm, sessionDate: e.target.value })} />
              </div>
              <div>
                <label htmlFor="correct-sessionTime" className="block text-xs font-medium text-slate-600 mb-1">Hora de sesión</label>
                <input id="correct-sessionTime" type="time" className="input-field" value={editForm.sessionTime}
                  onChange={e => setEditForm({ ...editForm, sessionTime: e.target.value })} />
              </div>
              <div>
                <label htmlFor="correct-sessionType" className="block text-xs font-medium text-slate-600 mb-1">Tipo de sesión</label>
                <select id="correct-sessionType" className="input-field" value={editForm.sessionType}
                  onChange={e => setEditForm({ ...editForm, sessionType: e.target.value })}>
                  <option value="IN_PERSON">Presencial</option>
                  <option value="TELEMED">Telemedicina</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label htmlFor="correct-consultReason" className="block text-xs font-medium text-slate-600 mb-1">Motivo de consulta</label>
                <textarea id="correct-consultReason" rows={2} className="input-field resize-none text-slate-800 placeholder-slate-400"
                  value={editForm.consultReason}
                  onChange={e => setEditForm({ ...editForm, consultReason: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="correct-intervention" className="block text-xs font-medium text-slate-600 mb-1">Intervención realizada</label>
                <textarea id="correct-intervention" rows={3} className="input-field resize-none text-slate-800 placeholder-slate-400"
                  value={editForm.intervention}
                  onChange={e => setEditForm({ ...editForm, intervention: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="correct-agreements" className="block text-xs font-medium text-slate-600 mb-1">Tareas y acuerdos</label>
                <textarea id="correct-agreements" rows={2} className="input-field resize-none text-slate-800 placeholder-slate-400"
                  value={editForm.agreements}
                  onChange={e => setEditForm({ ...editForm, agreements: e.target.value })} />
              </div>
              <div>
                <label htmlFor="correct-nextSessionDate" className="block text-xs font-medium text-slate-600 mb-1">Próxima sesión — Fecha</label>
                <input id="correct-nextSessionDate" type="date" className="input-field" value={editForm.nextSessionDate}
                  onChange={e => setEditForm({ ...editForm, nextSessionDate: e.target.value })} />
              </div>
              <div>
                <label htmlFor="correct-nextSessionTime" className="block text-xs font-medium text-slate-600 mb-1">Próxima sesión — Hora</label>
                <input id="correct-nextSessionTime" type="time" className="input-field" value={editForm.nextSessionTime}
                  onChange={e => setEditForm({ ...editForm, nextSessionTime: e.target.value })} />
              </div>
            </div>
            {editError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-4 flex items-center gap-2">
                <AlertCircle size={14} className="text-red-500 shrink-0" />
                <p className="text-red-600 text-sm">{editError}</p>
              </div>
            )}
            <div className="flex gap-3 mt-6">
              <button type="submit" className="btn-primary" disabled={correctMutation.isPending}>
                {correctMutation.isPending ? 'Guardando...' : 'Guardar corrección'}
              </button>
              <button
                type="button"
                onClick={() => { setEditingConsultation(null); setEditError(''); }}
                className="btn-secondary"
              >
                Cancelar
              </button>
            </div>
            </form>
        </Modal>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-0 overflow-hidden">
          <button
            onClick={() => setShowPatientList(!showPatientList)}
            className="w-full p-4 border-b border-slate-100 flex items-center justify-between text-left"
          >
            <p className="font-medium text-slate-700 text-sm">
              {selectedPatient ? selectedPatient.fullName : 'Seleccionar paciente'}
            </p>
            {showPatientList
              ? <ChevronUp size={16} className="text-slate-400" />
              : <ChevronDown size={16} className="text-slate-400" />
            }
          </button>
          {showPatientList && (
            <>
              <div className="p-3 border-b border-slate-100">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="input-field pl-8 text-xs" placeholder="Buscar..."
                    value={search} onChange={e => setSearch(e.target.value)} />
                </div>
              </div>
              <div className="divide-y divide-slate-50 max-h-64 lg:max-h-96 overflow-auto">
                {filteredPatients.map((p: Patient) => (
                  <button key={p.id}
                    onClick={() => { setSelectedPatientId(p.id); setShowPatientList(false); }}
                    className={`w-full text-left px-4 py-3 hover:bg-cream-50 transition-colors ${
                      selectedPatientId === p.id ? 'bg-sage-50 border-l-2 border-sage-500' : ''
                    }`}>
                    <p className="text-sm font-medium text-slate-800">{p.fullName}</p>
                    <p className="text-xs text-slate-500">{p.rut}</p>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          {!selectedPatientId ? (
            <div className="card flex items-center justify-center h-48">
              <p className="text-slate-500 text-sm text-center px-4">
                Selecciona un paciente para ver su historial
              </p>
            </div>
          ) : consultations.length === 0 ? (
            <div className="card flex items-center justify-center h-48">
              <p className="text-slate-500 text-sm">Sin consultas registradas</p>
            </div>
          ) : (
            consultations.map((c: Consultation) => {
              const isExpanded = expandedHistory.has(c.id);
              return (
                <div key={c.id}>
                  <div className="card">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-medium text-slate-800 text-sm md:text-base capitalize">
                          {formatChileDateTime(c.sessionDate)}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            c.sessionType === 'TELEMED' ? 'bg-blue-50 text-blue-600' : 'bg-sage-50 text-sage-600'
                          }`}>
                            {c.sessionType === 'TELEMED' ? 'Telemedicina' : 'Presencial'}
                          </span>
                          {c.history.length > 0 && (
                            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                              {c.history.length} corrección{c.history.length > 1 ? 'es' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => handleEditOpen(c)}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                        title="Corregir sesión">
                        <Pencil size={14} />
                      </button>
                    </div>
                    <div className="space-y-3 text-sm">
                      <div>
                        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Motivo</p>
                        <p className="text-slate-800">{c.consultReason}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Intervención</p>
                        <p className="text-slate-800">{c.intervention}</p>
                      </div>
                      {c.agreements && (
                        <div>
                          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Acuerdos</p>
                          <p className="text-slate-800">{c.agreements}</p>
                        </div>
                      )}
                      {c.nextSessionDate && (
                        <div className="pt-2 border-t border-slate-100">
                          <p className="text-xs text-slate-500">
                            Próxima sesión: <span className="font-medium text-slate-600">
                              {formatChileDate(c.nextSessionDate)}
                            </span>
                          </p>
                        </div>
                      )}
                      <p className="text-xs text-slate-500">Terapeuta: {c.therapist?.name}</p>
                    </div>

                    {c.history.length > 0 && (
                      <button
                        onClick={() => toggleHistory(c.id)}
                        className="mt-3 pt-3 border-t border-slate-100 w-full flex items-center gap-1 text-xs text-slate-500 hover:text-slate-600 transition-colors"
                      >
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        {isExpanded ? 'Ocultar' : 'Ver'} historial de correcciones ({c.history.length})
                      </button>
                    )}
                  </div>

                  {isExpanded && c.history.map((h: ConsultationHistory) => (
                    <div key={h.id} className="card mt-2 ml-4 opacity-60 border-dashed border-amber-200 bg-amber-50/30">
                      <div className="mb-2">
                        <p className="text-xs font-medium text-slate-600">
                          {formatChileDateTime(h.snapshot.sessionDate)}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Corregido el {formatChileDateTime(h.editedAt)} por {h.editedBy.name}
                        </p>
                      </div>
                      <div className="space-y-2 text-xs text-slate-600">
                        <div>
                          <p className="font-medium text-slate-500 uppercase tracking-wide mb-0.5">Motivo</p>
                          <p>{h.snapshot.consultReason}</p>
                        </div>
                        <div>
                          <p className="font-medium text-slate-500 uppercase tracking-wide mb-0.5">Intervención</p>
                          <p>{h.snapshot.intervention}</p>
                        </div>
                        {h.snapshot.agreements && (
                          <div>
                            <p className="font-medium text-slate-500 uppercase tracking-wide mb-0.5">Acuerdos</p>
                            <p>{h.snapshot.agreements}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}