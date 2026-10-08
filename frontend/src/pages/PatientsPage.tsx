import { useCallback, useMemo, useState } from "react";
import { List, useDynamicRowHeight, type RowComponentProps } from "react-window";
import { UserPlus, Search, Download, Trash2, Eye, Pencil, AlertCircle } from "lucide-react";
import { normalizeRut, formatRut, validateRut } from "../utils/rut";
import { getApiErrorMessage } from "../utils/api-error";
import { isMinorOnChileDay } from "../utils/age";
import { downloadPatientReport } from "../api/reports";
import { downloadBlob } from "../utils/download";
import {
  useDebouncedValue,
  usePatients,
  useCreatePatient,
  useDeletePatient,
  useBulkDeclareConsent,
} from "../hooks/usePatients";
import * as documentsApi from "../api/documents";
import PatientForm, { type PatientFormValues, type StagedDocument } from "../components/patients/PatientForm";
import PatientModal from "../components/patients/PatientModal";
import PatientsPagination from "../components/patients/PatientsPagination";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import EmptyState from "../components/ui/EmptyState";
import ErrorBanner from "../components/ui/ErrorBanner";
import {
  EMPTY_CONSENTS,
  CONSENT_PURPOSE_LABELS,
  type ConsentPurpose,
  type ConsentStatus,
  type Patient,
} from "../types/patient";

// issue #290: la lista se pagina y se busca en el servidor.
const PATIENTS_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

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
// Bloque Menores (M5): documentos que otorgan consentimiento y, en un menor,
// requieren un representante (no puede existir aún al crear la ficha).
const MINOR_GUARDIAN_DOC_TYPES = ["INFORMED_CONSENT", "TELEMED_AGREEMENT"];

// Menor sin representante con facultad de consentir, o con consentimiento
// legado: se marca en la lista para regularizarlo antes de la fecha límite.
const needsMinorAttention = (p: Patient) =>
  p.minorStatus === "MISSING_GUARDIAN" || p.minorStatus === "LEGACY_CONSENT";

function MinorStatusBadge({ patient }: { patient: Patient }) {
  if (!needsMinorAttention(patient)) return null;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 whitespace-nowrap">
      {patient.minorStatus === "MISSING_GUARDIAN"
        ? "Menor sin representante"
        : "Menor: consentimiento por regularizar"}
    </span>
  );
}

const hasAnyConsent = (p: Patient) => Boolean(p.consents?.TREATMENT || p.consents?.TELEMEDICINE);

// Issue #206: con años de datos acumulados, `filtered.map(...)` montaba
// cientos de <tr>/cards a la vez. react-window (List) solo monta las filas
// visibles -- el buscador sigue filtrando el array completo en memoria
// (sin cambios), esto solo cambia CÓMO se pintan los resultados.
//
// La tabla desktop no puede virtualizarse como <table> real: react-window
// posiciona cada fila con `position: absolute`, y un <tr> fuera del flujo
// normal de la tabla pierde la sincronización de anchos de columna con el
// resto de las filas (bug conocido, no es específico de esta librería). En
// vez de eso, tabla y filas comparten el mismo `grid-template-columns`
// inline (una sola fuente de verdad) con roles ARIA de tabla.
const PATIENT_TABLE_COLUMNS = "minmax(200px,2fr) 130px minmax(140px,1fr) 150px 110px 150px";
const PATIENT_TABLE_ROW_HEIGHT = 76;
// Altura estimada inicial de una card; la altura real se mide por fila
// (useDynamicRowHeight) porque un valor fijo recortaba los botones de acción
// cuando el nombre/email envolvía a varias líneas o con zoom de texto (#298).
const PATIENT_CARD_ROW_HEIGHT = 208;
const PATIENT_LIST_HEIGHT = 560;

interface PatientRowSharedProps {
  items: Patient[];
  selectedForConsent: Set<string>;
  onToggleConsent: (id: string) => void;
  onView: (p: Patient) => void;
  onEdit: (p: Patient) => void;
  onDownload: (p: Patient) => void;
  onDelete: (p: Patient) => void;
}

function PatientTableRow({
  index,
  style,
  items,
  selectedForConsent,
  onToggleConsent,
  onView,
  onEdit,
  onDownload,
  onDelete,
}: RowComponentProps<PatientRowSharedProps>) {
  const p = items[index];
  return (
    <div
      role="row"
      style={{ ...style, gridTemplateColumns: PATIENT_TABLE_COLUMNS }}
      className="grid items-center gap-4 px-6 border-b border-slate-50 hover:bg-cream-50 transition-colors"
    >
      <div role="cell">
        <p className="font-medium text-slate-800">{p.fullName}</p>
        <p className="text-xs text-slate-500">{p.email}</p>
        <MinorStatusBadge patient={p} />
      </div>
      <div role="cell" className="text-slate-600 font-mono text-xs">
        {displayRut(p.rut)}
      </div>
      <div role="cell" className="text-slate-600">
        {p.phone}
      </div>
      <div role="cell">
        <span
          className={`text-xs px-2 py-1 rounded-full ${
            hasAnyConsent(p) ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {hasAnyConsent(p) ? "Consentimiento ✓" : "Sin consentimiento"}
        </span>
      </div>
      <div role="cell">
        {!hasAnyConsent(p) && (
          <input
            type="checkbox"
            checked={selectedForConsent.has(p.id)}
            onChange={() => onToggleConsent(p.id)}
            aria-label={`Declarar consentimiento retroactivo de ${p.fullName}`}
          />
        )}
      </div>
      <div role="cell" className="flex items-center gap-2">
        <button
          onClick={() => onView(p)}
          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
          title="Ver detalle"
          aria-label={`Ver detalle de ${p.fullName}`}
        >
          <Eye size={15} />
        </button>
        <button
          onClick={() => onEdit(p)}
          className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-400 transition-colors"
          title="Editar"
          aria-label={`Editar a ${p.fullName}`}
        >
          <Pencil size={15} />
        </button>
        <button
          onClick={() => onDownload(p)}
          className="p-1.5 hover:bg-sage-50 rounded-lg text-sage-600 transition-colors"
          title="Descargar PDF"
          aria-label={`Descargar ficha PDF de ${p.fullName}`}
        >
          <Download size={15} />
        </button>
        <button
          onClick={() => onDelete(p)}
          className="p-1.5 hover:bg-red-50 rounded-lg text-red-400 transition-colors"
          title="Eliminar"
          aria-label={`Eliminar a ${p.fullName}`}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

function PatientCardRow({
  index,
  style,
  items,
  selectedForConsent,
  onToggleConsent,
  onView,
  onEdit,
  onDownload,
  onDelete,
}: RowComponentProps<PatientRowSharedProps>) {
  const p = items[index];
  return (
    <div style={style} className="pb-3">
      <div className="card p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="font-medium text-slate-800">{p.fullName}</p>
            <p className="text-xs text-slate-500 font-mono">{displayRut(p.rut)}</p>
            <MinorStatusBadge patient={p} />
          </div>
          <span
            className={`text-xs px-2 py-1 rounded-full shrink-0 ${
              hasAnyConsent(p) ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
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
              onChange={() => onToggleConsent(p.id)}
            />
            Declarar consentimiento retroactivo
          </label>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => onView(p)}
            className="btn-secondary text-xs py-1 flex items-center gap-1"
          >
            <Eye size={13} /> Ver
          </button>
          <button
            onClick={() => onEdit(p)}
            className="btn-secondary text-xs py-1 flex items-center gap-1 text-blue-500"
          >
            <Pencil size={13} /> Editar
          </button>
          <button
            onClick={() => onDownload(p)}
            className="btn-primary text-xs py-1 flex items-center gap-1"
          >
            <Download size={13} /> PDF
          </button>
          <button
            onClick={() => onDelete(p)}
            aria-label={`Eliminar paciente ${p.fullName}`}
            className="text-xs py-1 px-2 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 flex items-center gap-1"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [createNotice, setCreateNotice] = useState("");
  const [stagedDocuments, setStagedDocuments] = useState<StagedDocument[]>([]);

  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const {
    data: patientsPage,
    isLoading: patientsLoading,
    isError: patientsError,
  } = usePatients({ page, pageSize: PATIENTS_PAGE_SIZE, search: debouncedSearch });
  const filtered = useMemo(() => patientsPage?.data ?? [], [patientsPage]);
  const totalPatients = patientsPage?.total ?? 0;
  const cardRowHeight = useDynamicRowHeight({ defaultRowHeight: PATIENT_CARD_ROW_HEIGHT });
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

  // La selección solo vale para filas visibles: las ocultas por el buscador o
  // eliminadas no deben recibir una declaración que el terapeuta no ve.
  const visibleSelectedIds = useMemo(
    () => filtered.filter((p) => selectedForConsent.has(p.id) && !hasAnyConsent(p)).map((p) => p.id),
    [filtered, selectedForConsent],
  );
  const visibleSelected = useMemo(() => new Set(visibleSelectedIds), [visibleSelectedIds]);

  // Si tras eliminar quedó vacía la última página, vuelve a la última con
  // datos (ajuste de estado durante el render, patrón recomendado por React).
  if (patientsPage && patientsPage.data.length === 0 && page > 1) {
    setPage(Math.max(1, Math.ceil(patientsPage.total / PATIENTS_PAGE_SIZE)));
  }

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const resetCreateForm = () => {
    setForm(emptyForm);
    setFormConsents(EMPTY_CONSENTS);
    setRutError("");
    setFormError("");
    setStagedDocuments([]);
  };

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
      { patientIds: visibleSelectedIds, purpose: bulkPurpose, evidence: bulkEvidence.trim() },
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
    setCreateNotice("");
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
        onSuccess: async ({ patient, failedPurposes, deferredPurposes }) => {
          setShowForm(false);
          resetCreateForm();

          const messages: string[] = [];
          if (failedPurposes.length > 0) {
            messages.push(
              `Paciente creado, pero no se pudo registrar el consentimiento de ${failedPurposes.length} finalidad(es). Puedes otorgarlo desde la edición de la ficha.`,
            );
          }

          // Bloque Menores: sin representante todavía no se puede otorgar el
          // consentimiento de un menor ni subir documentos que lo otorgan.
          const minorPatient = isMinorOnChileDay(form.birthDate);
          if (deferredPurposes.length > 0) {
            messages.push(
              "Paciente menor de edad creado: agrega a su representante legal desde la ficha y luego registra el consentimiento.",
            );
          }
          const docsToUpload = minorPatient
            ? stagedDocuments.filter((doc) => !MINOR_GUARDIAN_DOC_TYPES.includes(doc.type))
            : stagedDocuments;
          const heldDocs = stagedDocuments.length - docsToUpload.length;
          if (heldDocs > 0) {
            messages.push(
              `${heldDocs} documento(s) de consentimiento no se subieron porque requieren un representante legal: súbelos desde la ficha una vez agregado.`,
            );
          }

          // Recién acá existe el patientId -- documentsApi.uploadPatientDocument
          // lo exige, así que estos uploads no pueden dispararse antes de que
          // la creación del paciente resuelva.
          if (docsToUpload.length > 0) {
            const results = await Promise.allSettled(
              docsToUpload.map((doc) =>
                documentsApi.uploadPatientDocument(patient.id, doc.file, doc.type),
              ),
            );
            const failedDocs = docsToUpload.filter((_, i) => results[i].status === "rejected");
            if (failedDocs.length > 0) {
              messages.push(
                `No se pudieron subir ${failedDocs.length} documento(s): ${failedDocs
                  .map((d) => d.file.name)
                  .join(", ")}. Puedes reintentar desde la ficha del paciente.`,
              );
            }
          }

          setCreateNotice(messages.join(" "));
        },
        onError: (err) => {
          setFormError(getApiErrorMessage(err, "Error al guardar paciente"));
        },
      },
    );
  };

  const handleToggleForm = () => {
    setCreateNotice("");
    if (showForm) resetCreateForm();
    setShowForm(!showForm);
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

  const patientRowKey = useCallback(
    (index: number, data: PatientRowSharedProps) => data.items[index].id,
    [],
  );

  const sharedRowProps: PatientRowSharedProps = {
    items: filtered,
    selectedForConsent: visibleSelected,
    onToggleConsent: toggleConsentSelection,
    onView: (p) => setModalIntent({ patient: p, tab: "detail" }),
    onEdit: (p) => setModalIntent({ patient: p, tab: "edit" }),
    onDownload: handleDownloadReport,
    onDelete: setPatientToDelete,
  };

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div>
          <h2 className="font-display text-2xl md:text-3xl text-slate-900">Pacientes</h2>
          <p className="text-slate-500 text-sm mt-1">
            {patientsLoading
              ? "Cargando..."
              : debouncedSearch
                ? `${totalPatients} ${totalPatients === 1 ? "resultado" : "resultados"} para la búsqueda`
                : `${totalPatients} pacientes registrados`}
          </p>
        </div>
        <button onClick={handleToggleForm} aria-expanded={showForm} className="btn-primary flex items-center gap-2">
          <UserPlus size={16} />
          <span className="hidden sm:inline">Nuevo paciente</span>
          <span className="sm:hidden">Nuevo</span>
        </button>
      </div>

      {(listError || patientsError) && (
        <ErrorBanner
          icon
          className="mb-4"
          message={listError || "No se pudo cargar la lista de pacientes. Reintenta más tarde."}
        />
      )}

      {createNotice && <ErrorBanner icon className="mb-4" message={createNotice} />}

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
            resetCreateForm();
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
          aria-label="Buscar pacientes por nombre o RUT"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
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

      {visibleSelectedIds.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-medium text-amber-900 mb-1">
            Declarar consentimiento retroactivo para {visibleSelectedIds.length} paciente(s)
          </p>
          <p className="text-sm text-amber-800 mb-1">
            <span className="font-medium">¿Por qué aparece esto?</span> El sistema exige un consentimiento
            informado vigente para poder registrar consultas. Estos pacientes ya estaban en tratamiento
            antes de que ese control existiera, o fueron autoagendados por la web pública, así que no
            tienen el registro digital — aunque el consentimiento sí exista en papel, en el expediente
            físico.
          </p>
          <p className="text-sm text-amber-800 mb-2">
            <span className="font-medium">¿Para qué sirve declararlo?</span> Esta acción no reemplaza el
            consentimiento en papel: deja constancia en el sistema de que ya fue obtenido, para poder
            seguir registrando consultas de estos pacientes sin quedar bloqueado. Declarar solo si el
            paciente realmente firmó el consentimiento — el terapeuta queda como responsable de esa
            declaración. Si el documento está digitalizado, debe subirse desde la ficha del paciente en
            vez de declararlo aquí.
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
      <div className="hidden md:block card p-0 overflow-hidden" role="table" aria-label="Pacientes">
        <div
          role="row"
          style={{ gridTemplateColumns: PATIENT_TABLE_COLUMNS }}
          className="grid gap-4 bg-slate-50 border-b border-slate-100 px-6"
        >
          <div role="columnheader" className="py-3 text-xs font-medium text-slate-500">Paciente</div>
          <div role="columnheader" className="py-3 text-xs font-medium text-slate-500">RUT</div>
          <div role="columnheader" className="py-3 text-xs font-medium text-slate-500">Contacto</div>
          <div role="columnheader" className="py-3 text-xs font-medium text-slate-500">Estado</div>
          <div role="columnheader" className="py-3 text-xs font-medium text-slate-500">Retroactivo</div>
          <div role="columnheader" className="py-3 text-xs font-medium text-slate-500">Acciones</div>
        </div>
        {patientsLoading ? (
          <div className="text-center py-12 text-slate-500">Cargando pacientes...</div>
        ) : filtered.length === 0 ? (
          <EmptyState message="No se encontraron pacientes." className="py-12" />
        ) : (
          <List
            role="rowgroup"
            rowComponent={PatientTableRow}
            rowCount={filtered.length}
            rowHeight={PATIENT_TABLE_ROW_HEIGHT}
            rowProps={sharedRowProps}
            rowKey={patientRowKey}
            overscanCount={6}
            style={{ height: PATIENT_LIST_HEIGHT }}
          />
        )}
      </div>

      {/* Cards móvil */}
      <div className="md:hidden">
        {patientsLoading ? (
          <div className="card text-center py-8 text-slate-500 text-sm">
            Cargando pacientes...
          </div>
        ) : filtered.length === 0 ? (
          <div className="card">
            <EmptyState message="No se encontraron pacientes." />
          </div>
        ) : (
          <List
            rowComponent={PatientCardRow}
            rowCount={filtered.length}
            rowHeight={cardRowHeight}
            rowProps={sharedRowProps}
            rowKey={patientRowKey}
            overscanCount={4}
            style={{ height: PATIENT_LIST_HEIGHT }}
          />
        )}
      </div>

      <PatientsPagination
        page={page}
        pageSize={PATIENTS_PAGE_SIZE}
        total={totalPatients}
        onPageChange={setPage}
      />

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
