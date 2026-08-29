import { useRef, useState } from "react";
import {
  AlertCircle,
  ChevronRight,
  Download,
  Eye,
  FileText,
  History,
  Pencil,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import Modal from "../ui/Modal";
import ErrorBanner from "../ui/ErrorBanner";
import FormField from "../ui/FormField";
import {
  CONSENT_PURPOSE_LABELS,
  EMPTY_CONSENTS,
  FIELD_LABELS,
  type ConsentPurpose,
  type ConsentStatus,
  type Patient,
} from "../../types/patient";
import { useUpdatePatient } from "../../hooks/usePatients";
import {
  usePatientDocuments,
  useUploadPatientDocument,
} from "../../hooks/usePatientDocuments";
import { usePatientHistory } from "../../hooks/usePatientHistory";
import { downloadDocument } from "../../api/documents";
import { downloadPatientReport } from "../../api/reports";
import { downloadBlob } from "../../utils/download";
import { getApiErrorMessage } from "../../utils/api-error";

type ModalTab = "detail" | "edit" | "history";

const displayRut = (rut: string) =>
  rut.replace(/\./g, "").replace(/(\d{1,3})(\d{3})(\d{3})([\dkK])$/, "$1.$2.$3-$4");

function formatFieldValue(key: string, val: unknown): string {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "boolean") return val ? "Sí" : "No";
  if (key === "birthDate" || key.toLowerCase().includes("date")) {
    try {
      return new Date(val as string).toLocaleDateString("es-CL");
    } catch {
      return String(val);
    }
  }
  return String(val);
}

interface PatientModalProps {
  patient: Patient;
  initialTab: ModalTab;
  onClose: () => void;
}

export default function PatientModal({ patient, initialTab, onClose }: PatientModalProps) {
  const [selected, setSelected] = useState(patient);
  const [modalTab, setModalTab] = useState<ModalTab>(initialTab);
  const [docError, setDocError] = useState("");
  const [docType, setDocType] = useState("INFORMED_CONSENT");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editForm, setEditForm] = useState<Partial<Patient>>({
    fullName: patient.fullName,
    phone: patient.phone,
    email: patient.email,
    occupation: patient.occupation,
    address: patient.address,
    emergencyContactName: patient.emergencyContactName,
    emergencyContactPhone: patient.emergencyContactPhone,
    treatingPsychiatrist: patient.treatingPsychiatrist,
    treatingDoctor: patient.treatingDoctor,
    defaultSessionAmount: patient.defaultSessionAmount,
  });
  const [editConsents, setEditConsents] = useState<ConsentStatus>(
    patient.consents ?? EMPTY_CONSENTS,
  );
  const [editReason, setEditReason] = useState("");
  const [editError, setEditError] = useState("");

  const documentsQuery = usePatientDocuments(selected.id);
  const uploadDocument = useUploadPatientDocument(selected.id);
  const historyQuery = usePatientHistory(selected.id, modalTab === "history");
  const updateMutation = useUpdatePatient();

  const handleOpenEdit = () => {
    setEditForm({
      fullName: selected.fullName,
      phone: selected.phone,
      email: selected.email,
      occupation: selected.occupation,
      address: selected.address,
      emergencyContactName: selected.emergencyContactName,
      emergencyContactPhone: selected.emergencyContactPhone,
      treatingPsychiatrist: selected.treatingPsychiatrist,
      treatingDoctor: selected.treatingDoctor,
      defaultSessionAmount: selected.defaultSessionAmount,
    });
    setEditConsents(selected.consents ?? EMPTY_CONSENTS);
    setEditReason("");
    setEditError("");
    setModalTab("edit");
  };

  const handleSubmitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editReason.trim()) {
      setEditError("El motivo de la modificación es obligatorio");
      return;
    }
    if (editReason.trim().length < 10) {
      setEditError("El motivo debe tener al menos 10 caracteres");
      return;
    }
    setEditError("");

    // T6.1: solo se emiten eventos para las finalidades cuyo checkbox
    // efectivamente cambió respecto del estado vigente del paciente.
    const originalConsents = selected.consents ?? EMPTY_CONSENTS;
    const consentChanges = (Object.keys(editConsents) as ConsentPurpose[])
      .filter((purpose) => editConsents[purpose] !== originalConsents[purpose])
      .map((purpose) => ({
        purpose,
        action: (editConsents[purpose] ? "GRANT" : "REVOKE") as "GRANT" | "REVOKE",
      }));

    updateMutation.mutate(
      { id: selected.id, data: { ...editForm, reason: editReason }, consentChanges },
      {
        onSuccess: ({ patient: refreshed, failed }) => {
          setSelected(refreshed);
          setEditForm({});
          setEditReason("");
          if (failed.length > 0) {
            // Se queda en la pestaña de edición para que el mensaje sea
            // visible y el usuario pueda reintentar los que fallaron.
            setEditError(
              `Los datos del paciente se guardaron, pero no se pudo registrar el consentimiento de: ${failed
                .map((c) => CONSENT_PURPOSE_LABELS[c.purpose])
                .join(", ")}. Vuelve a intentarlo.`,
            );
          } else {
            setModalTab("detail");
            setEditError("");
          }
        },
        onError: (err) => {
          setEditError(getApiErrorMessage(err, "Error al actualizar paciente"));
        },
      },
    );
  };

  const handleDownloadReport = async () => {
    try {
      const blob = await downloadPatientReport(selected.id);
      downloadBlob(blob, `ficha-${selected.id}.pdf`);
    } catch (err) {
      setDocError(getApiErrorMessage(err, "No se pudo descargar la ficha"));
    }
  };

  const handleUpload = (file: File) => {
    setDocError("");
    uploadDocument.mutate(
      { file, type: docType },
      {
        onError: (err) => {
          setDocError(getApiErrorMessage(err, "No se pudo subir el documento"));
        },
      },
    );
  };

  const handleDownloadDoc = async (docId: string, fileName: string) => {
    try {
      const blob = await downloadDocument(docId);
      downloadBlob(blob, fileName);
    } catch (err) {
      setDocError(getApiErrorMessage(err, "No se pudo descargar el documento"));
    }
  };

  const documents = documentsQuery.data ?? [];
  const history = historyQuery.data ?? [];

  return (
    <Modal
      onClose={onClose}
      labelledBy="patient-modal-title"
      className="max-w-lg max-h-[90vh] flex flex-col"
    >
        <div className="flex items-start justify-between p-6 pb-0">
          <div>
            <h3 id="patient-modal-title" className="font-display text-2xl text-slate-900">
              {selected.fullName}
            </h3>
            <p className="text-slate-500 text-sm font-mono">{displayRut(selected.rut)}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 ml-4"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex gap-1 px-6 pt-4 border-b border-slate-100">
          <button
            onClick={() => setModalTab("detail")}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              modalTab === "detail"
                ? "text-slate-900 border-b-2 border-slate-900 -mb-px"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <Eye size={14} /> Detalle
          </button>
          <button
            onClick={handleOpenEdit}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              modalTab === "edit"
                ? "text-blue-600 border-b-2 border-blue-600 -mb-px"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <Pencil size={14} /> Editar
          </button>
          <button
            onClick={() => setModalTab("history")}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              modalTab === "history"
                ? "text-amber-600 border-b-2 border-amber-600 -mb-px"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <History size={14} /> Historial
          </button>
        </div>

        <div className="overflow-auto flex-1 p-6">
          {modalTab === "detail" && (
            <>
              <div className="space-y-2 text-sm text-slate-700">
                <p>
                  <span className="font-medium">Nacimiento:</span>{" "}
                  {new Date(selected.birthDate).toLocaleDateString("es-CL")}
                </p>
                <p>
                  <span className="font-medium">Ocupación:</span> {selected.occupation || "—"}
                </p>
                <p>
                  <span className="font-medium">Teléfono:</span> {selected.phone || "—"}
                </p>
                <p>
                  <span className="font-medium">Email:</span> {selected.email || "—"}
                </p>
                <p>
                  <span className="font-medium">Dirección:</span> {selected.address || "—"}
                </p>
                <hr className="my-3 border-slate-100" />
                <p>
                  <span className="font-medium">Emergencia:</span>{" "}
                  {selected.emergencyContactName} — {selected.emergencyContactPhone}
                </p>
                <p>
                  <span className="font-medium">Psiquiatra:</span>{" "}
                  {selected.treatingPsychiatrist || "—"}
                </p>
                <p>
                  <span className="font-medium">Médico:</span> {selected.treatingDoctor || "—"}
                </p>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="font-medium text-slate-700 text-sm mb-3">Consentimientos</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(CONSENT_PURPOSE_LABELS) as ConsentPurpose[]).map((purpose) => (
                    <span
                      key={purpose}
                      className={`text-xs px-2 py-1 rounded-full ${
                        selected.consents?.[purpose]
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {CONSENT_PURPOSE_LABELS[purpose]}: {selected.consents?.[purpose] ? "✓" : "Pendiente"}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="font-medium text-slate-700 text-sm mb-3">Documentos legales</p>
                {docError && (
                  <p className="text-red-500 text-xs mb-3 flex items-center gap-1">
                    <AlertCircle size={11} /> {docError}
                  </p>
                )}
                {documentsQuery.isError && (
                  <p className="text-red-500 text-xs mb-3 flex items-center gap-1">
                    <AlertCircle size={11} /> No se pudieron cargar los documentos.
                  </p>
                )}
                {documentsQuery.isLoading ? (
                  <p className="text-xs text-slate-500">Cargando...</p>
                ) : documents.length === 0 ? (
                  <p className="text-xs text-slate-500 mb-3">Sin documentos subidos.</p>
                ) : (
                  <div className="space-y-2 mb-3">
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={14} className="text-slate-400 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-700 truncate">
                              {doc.fileName}
                            </p>
                            <p className="text-xs text-slate-500">{doc.type}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDownloadDoc(doc.id, doc.fileName)}
                          className="p-1.5 hover:bg-sage-50 rounded-lg text-sage-600 shrink-0"
                          aria-label={`Descargar ${doc.fileName}`}
                        >
                          <Download size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                    className="input-field text-xs py-1.5 flex-1"
                    aria-label="Tipo de documento a subir"
                  >
                    <option value="INFORMED_CONSENT">Consentimiento informado</option>
                    <option value="TELEMED_AGREEMENT">Acuerdo telemedicina</option>
                    <option value="OTHER">Otro</option>
                  </select>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,image/*"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) handleUpload(e.target.files[0]);
                    }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-secondary text-xs py-1.5 flex items-center gap-1 shrink-0"
                  >
                    <UploadIcon size={13} /> Subir
                  </button>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleDownloadReport}
                  className="btn-primary flex items-center gap-2"
                >
                  <Download size={14} /> Descargar PDF
                </button>
                <button onClick={onClose} className="btn-secondary">
                  Cerrar
                </button>
              </div>
            </>
          )}

          {modalTab === "edit" && (
            <form className="space-y-4" onSubmit={handleSubmitEdit}>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-amber-700 text-xs">
                  Toda modificación queda registrada con motivo y autor según normativa MINSAL.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField id="edit-fullName" label="Nombre completo">
                  <input
                    id="edit-fullName"
                    className="input-field"
                    value={editForm.fullName ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                  />
                </FormField>
                <FormField id="edit-phone" label="Teléfono">
                  <input
                    id="edit-phone"
                    className="input-field"
                    value={editForm.phone ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  />
                </FormField>
                <FormField id="edit-email" label="Email">
                  <input
                    id="edit-email"
                    type="email"
                    className="input-field"
                    value={editForm.email ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  />
                </FormField>
                <FormField id="edit-occupation" label="Ocupación">
                  <input
                    id="edit-occupation"
                    className="input-field"
                    value={editForm.occupation ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, occupation: e.target.value })}
                  />
                </FormField>
                <FormField id="edit-address" label="Dirección" className="md:col-span-2">
                  <input
                    id="edit-address"
                    className="input-field"
                    value={editForm.address ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  />
                </FormField>
                <FormField id="edit-emergencyContactName" label="Contacto emergencia">
                  <input
                    id="edit-emergencyContactName"
                    className="input-field"
                    value={editForm.emergencyContactName ?? ""}
                    onChange={(e) =>
                      setEditForm({ ...editForm, emergencyContactName: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="edit-emergencyContactPhone" label="Teléfono emergencia">
                  <input
                    id="edit-emergencyContactPhone"
                    className="input-field"
                    value={editForm.emergencyContactPhone ?? ""}
                    onChange={(e) =>
                      setEditForm({ ...editForm, emergencyContactPhone: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="edit-treatingPsychiatrist" label="Psiquiatra tratante">
                  <input
                    id="edit-treatingPsychiatrist"
                    className="input-field"
                    value={editForm.treatingPsychiatrist ?? ""}
                    onChange={(e) =>
                      setEditForm({ ...editForm, treatingPsychiatrist: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="edit-treatingDoctor" label="Médico tratante">
                  <input
                    id="edit-treatingDoctor"
                    className="input-field"
                    value={editForm.treatingDoctor ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, treatingDoctor: e.target.value })}
                  />
                </FormField>
                <FormField id="edit-defaultSessionAmount" label="Monto de sesión por defecto (CLP)">
                  <input
                    id="edit-defaultSessionAmount"
                    type="number"
                    min="0"
                    step="1"
                    className="input-field"
                    placeholder="Sin cobro automático"
                    value={editForm.defaultSessionAmount ?? ""}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        defaultSessionAmount: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </FormField>
                <div className="flex flex-wrap items-center gap-6 pt-2 md:col-span-2">
                  {(Object.keys(CONSENT_PURPOSE_LABELS) as ConsentPurpose[]).map((purpose) => (
                    <label
                      key={purpose}
                      className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={editConsents[purpose] ?? false}
                        onChange={(e) =>
                          setEditConsents({ ...editConsents, [purpose]: e.target.checked })
                        }
                        className="rounded"
                      />
                      {CONSENT_PURPOSE_LABELS[purpose]}
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-xs text-slate-500 -mt-2">
                Otorgar o revocar una finalidad de consentimiento aquí también queda registrado
                con el motivo indicado abajo como evidencia (Ley 21.719).
              </p>

              <div className="pt-2 border-t border-slate-100">
                <label htmlFor="edit-reason" className="block text-xs font-medium text-slate-700 mb-1">
                  Motivo de la modificación <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="edit-reason"
                  className="input-field resize-none"
                  rows={3}
                  placeholder="Ej: Corrección de número telefónico a solicitud del paciente en consulta del 09/03/2026"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                />
                <p className="text-xs text-slate-500 mt-1">
                  {editReason.length} caracteres (mínimo 10)
                </p>
              </div>

              {editError && <ErrorBanner icon message={editError} />}

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="btn-primary flex items-center gap-2"
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab("detail")}
                  className="btn-secondary"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {modalTab === "history" && (
            <div>
              {historyQuery.isLoading ? (
                <p className="text-sm text-slate-500 py-4">Cargando historial...</p>
              ) : historyQuery.isError ? (
                <p className="text-sm text-red-500 py-4 flex items-center gap-1">
                  <AlertCircle size={12} /> No se pudo cargar el historial.
                </p>
              ) : history.length === 0 ? (
                <div className="text-center py-8">
                  <History size={32} className="text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">Sin modificaciones registradas.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {history.map((entry) => (
                    <div key={entry.id} className="border border-slate-100 rounded-xl p-4">
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-xs font-medium text-slate-700">
                          {entry.changedBy.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(entry.changedAt).toLocaleString("es-CL")}
                        </p>
                      </div>
                      <div className="bg-amber-50 rounded-lg px-3 py-2 mb-3">
                        <p className="text-xs text-amber-700 italic">"{entry.reason}"</p>
                      </div>
                      <div className="space-y-1">
                        {Object.entries(entry.diff).map(([key, { from, to }]) => (
                          <div key={key} className="flex items-center gap-2 text-xs text-slate-600">
                            <span className="font-medium text-slate-500 w-32 shrink-0">
                              {FIELD_LABELS[key] ?? key}
                            </span>
                            <span className="text-red-400 line-through">
                              {formatFieldValue(key, from)}
                            </span>
                            <ChevronRight size={12} className="text-slate-300 shrink-0" />
                            <span className="text-emerald-600 font-medium">
                              {formatFieldValue(key, to)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
    </Modal>
  );
}
