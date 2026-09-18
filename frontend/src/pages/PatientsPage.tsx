import { useState } from "react";
import { UserPlus, Search, Download, Trash2, Eye, Pencil, AlertCircle } from "lucide-react";
import { normalizeRut, formatRut, validateRut } from "../utils/rut";
import { getApiErrorMessage } from "../utils/api-error";
import { downloadPatientReport } from "../api/reports";
import { downloadBlob } from "../utils/download";
import {
  usePatients,
  useCreatePatient,
  useDeletePatient,
  useBulkDeclareConsent,
} from "../hooks/usePatients";
import * as documentsApi from "../api/documents";
import PatientForm, { type PatientFormValues, type StagedDocument } from "../components/patients/PatientForm";
import PatientModal from "../components/patients/PatientModal";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import {
  EMPTY_CONSENTS,
  CONSENT_PURPOSE_LABELS,
  type ConsentPurpose,
  type ConsentStatus,
  type Patient,
} from "../types/patient";

const emptyForm: PatientFormValues = {
  fullName: "",
  rut: "",
  birthDate: "",
  occupation: "",
  phone: "",
  email: "",
  address: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  treatingPsychiatrist: "",
  treatingDoctor: "",
  defaultSessionAmount: "",
};

type ModalIntent = { patient: Patient; tab: "detail" | "edit" } | null;

const displayRut = (rut: string) => formatRut(rut.replace(/\./g, ""));

// Bug reportado por usuarios: el badge de consentimiento solo miraba
// consents.TREATMENT, así que un paciente con consentimiento SOLO de
// telemedicina (igual de válido) aparecía como "Sin consentimiento". El
// consentimiento de cualquiera de las dos finalidades habilita la ficha.
const hasAnyConsent = (p: Patient) => Boolean(p.consents?.TREATMENT || p.consents?.TELEMEDICINE);

export default function PatientsPage() {
  const [search, setSearch] = useState("");
  const [listError, setListError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [modalIntent, setModalIntent] = useState<ModalIntent>(null);
  const [patientToDelete, setPatientToDelete] = useState<Patient | null>(null);

  const [form, setForm] = useState<PatientFormValues>(emptyForm);
  const [formConsents, setFormConsents] = useState<ConsentStatus>(EMPTY_CONSENTS);
  const [rutError, setRutError] = useState("");
  const [formError, setFormError] = useState("");
  const [stagedDocuments, setStagedDocuments] = useState<StagedDocument[]>([]);

  const { data: patients = [], isError: patientsError } = usePatients();
  const createMutation = useCreatePatient();
  const deleteMutation = useDeletePatient();

  // Issue #131 (T5): declaración retroactiva en bloque para pacientes que ya
  // estaban en tratamiento antes de que el consentimiento fuera obligatorio
  // (ej: consentimiento en papel del expediente físico, nunca digitalizado).
  const [selectedForConsent, setSelectedForConsent] = useState<Set<string>>(new Set());
  const [bulkPurpose, setBulkPurpose] = useState<ConsentPurpose>("TREATMENT");
  const [bulkEvidence, setBulkEvidence] = useState("");
  const [bulkError, setBulkError] = useState("");
  const bulkConsentMutation = useBulkDeclareConsent();

  const toggleConsentSelection = (patientId: string) => {
    setSelectedForConsent((prev) => {
      const next = new Set(prev);
      if (next.has(patientId)) next.delete(patientId);
      else next.add(patientId);
      return next;
    });
  };

  const handleBulkDeclareConsent = () => {
    if (!bulkEvidence.trim() || bulkEvidence.trim().length < 10) {
      setBulkError("La evidencia debe tener al menos 10 caracteres (ej: dónde está el consentimiento en papel)");
      return;
    }
    setBulkError("");
    bulkConsentMutation.mutate(
      { patientIds: Array.from(selectedForConsent), purpose: bulkPurpose, evidence: bulkEvidence.trim() },
      {
        onSuccess: (results) => {
          const failed = results.filter((r) => !r.ok);
          setSelectedForConsent(new Set());
          setBulkEvidence("");
          if (failed.length > 0) {
            setBulkError(`${failed.length} paciente(s) no se pudieron declarar (revisa que sean tuyos).`);
          }
        },
        onError: (err) => {
          setBulkError(getApiErrorMessage(err, "No se pudo declarar el consentimiento en bloque"));
        },
      },
    );
  };

  const handleRutChange = (value: string) => {
    const formatted = formatRut(value);
    setForm({ ...form, rut: formatted });
    if (formatted.length > 3) {
      setRutError(validateRut(formatted) ? "" : "RUT inválido");
    } else {
      setRutError("");
    }
  };

  const handleSubmit = () => {
    if (!form.fullName.trim()) {
      setFormError("El nombre es obligatorio");
      return;
    }
    if (!form.rut.trim()) {
      setFormError("El RUT es obligatorio");
      return;
    }
    if (!validateRut(form.rut)) {
      setFormError("RUT inválido");
      return;
    }
    if (!form.birthDate) {
      setFormError("La fecha de nacimiento es obligatoria");
      return;
    }
    setFormError("");
    // sdd/online-payment-integration PR 3 (T9.7): el input queda vacío por
    // default ("Sin cobro automático") -- string vacío nunca se envía como
    // 0, se omite del payload (mismo criterio que defaultSessionAmount
    // ausente en el backend: PaymentsService.ensureCharge no genera cargo).
    const defaultSessionAmount = form.defaultSessionAmount.trim()
      ? Number(form.defaultSessionAmount)
      : undefined;
    createMutation.mutate(
      {
        data: { ...form, rut: normalizeRut(form.rut), defaultSessionAmount },
        consents: formConsents,
      },
      {
        onSuccess: async ({ patient, failedPurposes }) => {
          setShowForm(false);
          setForm(emptyForm);
          setFormConsents(EMPTY_CONSENTS);
          setRutError("");

          const messages: string[] = [];
          if (failedPurposes.length > 0) {
            messages.push(
              `Paciente creado, pero no se pudo registrar el consentimiento de ${failedPurposes.length} finalidad(es). Puedes otorgarlo desde la edición de la ficha.`,
            );
          }

          // Recién acá existe el patientId -- documentsApi.uploadPatientDocument
          // lo exige, así que estos uploads no pueden dispararse antes de que
          // la creación del paciente resuelva.
          if (stagedDocuments.length > 0) {
            const results = await Promise.allSettled(
              stagedDocuments.map((doc) =>
                documentsApi.uploadPatientDocument(patient.id, doc.file, doc.type),
              ),
            );
            const failedDocs = stagedDocuments.filter((_, i) => results[i].status === "rejected");
            setStagedDocuments([]);
            if (failedDocs.length > 0) {
              messages.push(
                `No se pudieron subir ${failedDocs.length} documento(s): ${failedDocs
                  .map((d) => d.file.name)
                  .join(", ")}. Puedes reintentar desde la ficha del paciente.`,
              );
            }
          }

          setFormError(messages.join(" "));
        },
        onError: (err) => {
          setFormError(getApiErrorMessage(err, "Error al guardar paciente"));
        },
      },
    );
  };

  const handleConfirmDelete = () => {
    if (!patientToDelete) return;
    deleteMutation.mutate(patientToDelete.id, {
      onSuccess: () => setListError(""),
      onError: (err) => setListError(getApiErrorMessage(err, "No se pudo eliminar el paciente")),
    });
    setPatientToDelete(null);
  };

  const handleDownloadReport = async (p: Patient) => {
    try {
      const blob = await downloadPatientReport(p.id);
      downloadBlob(blob, `ficha-${p.id}.pdf`);
    } catch (err) {
      setListError(getApiErrorMessage(err, "No se pudo descargar la ficha"));
    }
  };

  const filtered = patients.filter(
    (p: Patient) =>
      p.fullName.toLowerCase().includes(search.toLowerCase()) ||
      normalizeRut(p.rut).includes(normalizeRut(search)),
  );

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div>
          <h2 className="font-display text-2xl md:text-3xl text-slate-900">Pacientes</h2>
          <p className="text-slate-500 text-sm mt-1">{patients.length} pacientes registrados</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
          <UserPlus size={16} />
          <span className="hidden sm:inline">Nuevo paciente</span>
          <span className="sm:hidden">Nuevo</span>
        </button>
      </div>

      {(listError || patientsError) && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={14} className="text-red-500 shrink-0" />
          <p className="text-red-600 text-sm">
            {listError || "No se pudo cargar la lista de pacientes. Reintenta más tarde."}
          </p>
        </div>
      )}

      {showForm && (
        <PatientForm
          form={form}
          onChange={setForm}
          consents={formConsents}
          onConsentsChange={setFormConsents}
          rutError={rutError}
          onRutChange={handleRutChange}
          formError={formError}
          isPending={createMutation.isPending}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowForm(false);
            setStagedDocuments([]);
          }}
          stagedDocuments={stagedDocuments}
          onStagedDocumentsChange={setStagedDocuments}
        />
      )}

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input-field pl-9"
          placeholder="Buscar por nombre o RUT..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Issue #131 (review R3-002): el aviso vive FUERA de la caja de
          selección a propósito -- handleBulkDeclareConsent limpia
          selectedForConsent aunque el lote haya fallado parcialmente, así
          que un aviso anidado ahí adentro desaparecería con la selección
          antes de que el terapeuta llegue a leerlo. */}
      {bulkError && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={14} className="text-red-500 shrink-0" />
          <p className="text-red-600 text-sm">{bulkError}</p>
        </div>
      )}

      {selectedForConsent.size > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm text-amber-800 mb-2">
            Declarar consentimiento retroactivo para {selectedForConsent.size} paciente(s) —
            úsalo cuando ya tenés el consentimiento en papel del expediente físico, previo a este cambio.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              className="input-field sm:w-48"
              value={bulkPurpose}
              onChange={(e) => setBulkPurpose(e.target.value as ConsentPurpose)}
            >
              {(Object.keys(CONSENT_PURPOSE_LABELS) as ConsentPurpose[]).map((purpose) => (
                <option key={purpose} value={purpose}>
                  {CONSENT_PURPOSE_LABELS[purpose]}
                </option>
              ))}
            </select>
            <input
              className="input-field flex-1"
              placeholder="Evidencia (ej: consentimiento en papel, expediente físico)"
              value={bulkEvidence}
              onChange={(e) => setBulkEvidence(e.target.value)}
            />
            <button
              onClick={handleBulkDeclareConsent}
              disabled={bulkConsentMutation.isPending}
              className="btn-primary text-sm whitespace-nowrap"
            >
              Declarar
            </button>
            <button
              onClick={() => {
                setSelectedForConsent(new Set());
                setBulkError("");
              }}
              className="btn-secondary text-sm whitespace-nowrap"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Tabla desktop */}
      <div className="hidden md:block card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">Paciente</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">RUT</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">Contacto</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">Estado</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">Retroactivo</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-500">
                  No se encontraron pacientes.
                </td>
              </tr>
            ) : (
              filtered.map((p: Patient) => (
                <tr key={p.id} className="hover:bg-cream-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-medium text-slate-800">{p.fullName}</p>
                    <p className="text-xs text-slate-500">{p.email}</p>
                  </td>
                  <td className="px-6 py-4 text-slate-600 font-mono text-xs">
                    {displayRut(p.rut)}
                  </td>
                  <td className="px-6 py-4 text-slate-600">{p.phone}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        hasAnyConsent(p)
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {hasAnyConsent(p) ? "Consentimiento ✓" : "Sin consentimiento"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {!hasAnyConsent(p) && (
                      <input
                        type="checkbox"
                        checked={selectedForConsent.has(p.id)}
                        onChange={() => toggleConsentSelection(p.id)}
                        aria-label={`Declarar consentimiento retroactivo de ${p.fullName}`}
                      />
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setModalIntent({ patient: p, tab: "detail" })}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
                        title="Ver detalle"
                        aria-label={`Ver detalle de ${p.fullName}`}
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        onClick={() => setModalIntent({ patient: p, tab: "edit" })}
                        className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-400 transition-colors"
                        title="Editar"
                        aria-label={`Editar a ${p.fullName}`}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => handleDownloadReport(p)}
                        className="p-1.5 hover:bg-sage-50 rounded-lg text-sage-600 transition-colors"
                        title="Descargar PDF"
                        aria-label={`Descargar ficha PDF de ${p.fullName}`}
                      >
                        <Download size={15} />
                      </button>
                      <button
                        onClick={() => setPatientToDelete(p)}
                        className="p-1.5 hover:bg-red-50 rounded-lg text-red-400 transition-colors"
                        title="Eliminar"
                        aria-label={`Eliminar a ${p.fullName}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Cards móvil */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 ? (
          <div className="card text-center py-8 text-slate-500 text-sm">
            No se encontraron pacientes.
          </div>
        ) : (
          filtered.map((p: Patient) => (
            <div key={p.id} className="card p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-medium text-slate-800">{p.fullName}</p>
                  <p className="text-xs text-slate-500 font-mono">{displayRut(p.rut)}</p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full shrink-0 ${
                    hasAnyConsent(p)
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {hasAnyConsent(p) ? "✓" : "Pendiente"}
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                {p.phone} · {p.email}
              </p>
              {!hasAnyConsent(p) && (
                <label className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                  <input
                    type="checkbox"
                    checked={selectedForConsent.has(p.id)}
                    onChange={() => toggleConsentSelection(p.id)}
                  />
                  Declarar consentimiento retroactivo
                </label>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setModalIntent({ patient: p, tab: "detail" })}
                  className="btn-secondary text-xs py-1 flex items-center gap-1"
                >
                  <Eye size={13} /> Ver
                </button>
                <button
                  onClick={() => setModalIntent({ patient: p, tab: "edit" })}
                  className="btn-secondary text-xs py-1 flex items-center gap-1 text-blue-500"
                >
                  <Pencil size={13} /> Editar
                </button>
                <button
                  onClick={() => handleDownloadReport(p)}
                  className="btn-primary text-xs py-1 flex items-center gap-1"
                >
                  <Download size={13} /> PDF
                </button>
                <button
                  onClick={() => setPatientToDelete(p)}
                  className="text-xs py-1 px-2 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 flex items-center gap-1"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {modalIntent && (
        <PatientModal
          key={modalIntent.patient.id}
          patient={modalIntent.patient}
          initialTab={modalIntent.tab}
          onClose={() => setModalIntent(null)}
        />
      )}

      {patientToDelete && (
        <ConfirmDialog
          title="Eliminar paciente"
          message={`¿Eliminar a "${patientToDelete.fullName}"? Esta acción no se puede deshacer.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPatientToDelete(null)}
        />
      )}
    </div>
  );
}
