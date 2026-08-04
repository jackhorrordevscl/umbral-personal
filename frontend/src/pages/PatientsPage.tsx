import { useState } from "react";
import { UserPlus, Search, Download, Trash2, Eye, Pencil, AlertCircle } from "lucide-react";
import { normalizeRut, formatRut, validateRut } from "../utils/rut";
import { getApiErrorMessage } from "../utils/api-error";
import { downloadPatientReport } from "../api/reports";
import { downloadBlob } from "../utils/download";
import { usePatients, useCreatePatient, useDeletePatient } from "../hooks/usePatients";
import PatientForm, { type PatientFormValues } from "../components/patients/PatientForm";
import PatientModal from "../components/patients/PatientModal";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { EMPTY_CONSENTS, type ConsentStatus, type Patient } from "../types/patient";

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
};

type ModalIntent = { patient: Patient; tab: "detail" | "edit" } | null;

const displayRut = (rut: string) => formatRut(rut.replace(/\./g, ""));

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

  const { data: patients = [], isError: patientsError } = usePatients();
  const createMutation = useCreatePatient();
  const deleteMutation = useDeletePatient();

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
    createMutation.mutate(
      { data: { ...form, rut: normalizeRut(form.rut) }, consents: formConsents },
      {
        onSuccess: ({ failedPurposes }) => {
          setShowForm(false);
          setForm(emptyForm);
          setFormConsents(EMPTY_CONSENTS);
          setRutError("");
          setFormError(
            failedPurposes.length > 0
              ? `Paciente creado, pero no se pudo registrar el consentimiento de ${failedPurposes.length} finalidad(es). Puedes otorgarlo desde la edición de la ficha.`
              : "",
          );
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
          onCancel={() => setShowForm(false)}
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

      {/* Tabla desktop */}
      <div className="hidden md:block card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">Paciente</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">RUT</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">Contacto</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">Estado</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-slate-500">
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
                        p.consents?.TREATMENT
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {p.consents?.TREATMENT ? "Consentimiento ✓" : "Sin consentimiento"}
                    </span>
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
                    p.consents?.TREATMENT
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {p.consents?.TREATMENT ? "✓" : "Pendiente"}
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                {p.phone} · {p.email}
              </p>
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
