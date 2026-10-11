import { useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
import Modal from "../ui/Modal";
import ConfirmDialog from "../ui/ConfirmDialog";
import ErrorBanner from "../ui/ErrorBanner";
import FormField from "../ui/FormField";
import ClosureFields from "./ClosureFields";
import {
  EMPTY_CLOSURE,
  closureToPayload,
  getUploadErrorMessage,
  validateClosure,
  type ClosureValues,
} from "./closure";
import { getCancellationPreview } from "../../api/discharges";
import {
  useCorrectUploadDischarge,
  useCreateDischargeDraft,
  useIssueDischarge,
  useUpdateDischarge,
  useUploadDischarge,
} from "../../hooks/useDischarges";
import { useProfile } from "../../hooks/useProfile";
import type {
  CancellationPreview,
  IssueDischargeResult,
  TreatmentDischarge,
} from "../../types/discharge";
import { getApiErrorMessage } from "../../utils/api-error";
import { formatChileShortDateTime } from "../../utils/datetime";

// Mirrors the backend MAX_DOCUMENT_UPLOAD_BYTES (documents.controller.ts).
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_LISTED_CONSULTATIONS = 8;

type Step = "choose" | "closure" | "edit" | "upload";

interface DischargeFormProps {
  patientId: string;
  /** Existing DRAFT to keep editing (generated path). */
  draft?: TreatmentDischarge;
  /** Current ISSUED version with an uploaded PDF that is being replaced. */
  correctUploadOf?: TreatmentDischarge;
  onClose: () => void;
  onDone: (result: IssueDischargeResult) => void;
}

const dateOnly = (iso: string) => iso.slice(0, 10);
const todayLocal = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

function contentFromDraft(d?: TreatmentDischarge) {
  return {
    admissionDate: d ? dateOnly(d.admissionDate) : "",
    dischargeDate: d ? dateOnly(d.dischargeDate) : "",
    sessionCount: d ? String(d.sessionCount) : "0",
    consultReason: d?.consultReason ?? "",
    diagnosis: d?.diagnosis ?? "",
    evolutionSummary: d?.evolutionSummary ?? "",
    statusAtDischarge: d?.statusAtDischarge ?? "",
    recommendations: d?.recommendations ?? "",
  };
}

function closureFromDraft(d?: TreatmentDischarge): ClosureValues {
  if (!d) return EMPTY_CLOSURE;
  return {
    closureReason: d.closureReason,
    dropoutReason: d.dropoutReason ?? "",
    dropoutNote: d.dropoutNote ?? "",
    referralDestination: d.referralDestination ?? "",
  };
}

function describeCancellation(preview: CancellationPreview): string {
  const shown = preview.consultations
    .slice(0, MAX_LISTED_CONSULTATIONS)
    .map((c) => formatChileShortDateTime(c.sessionDate));
  const extra = preview.count - shown.length;
  const list = shown.join("; ") + (extra > 0 ? `; y ${extra} más` : "");
  const noun = preview.count === 1 ? "1 consulta futura" : `${preview.count} consultas futuras`;
  return `Al cerrar el tratamiento se cancelará${preview.count === 1 ? "" : "n"} ${noun}: ${list}. Esta acción no se puede deshacer.`;
}

// Closure flow of T5b. Two paths: generate the report with the system
// (draft -> editable prefilled form -> issue) or upload the therapist's own
// PDF. Any path that issues a closure asks for confirmation first when it
// would cancel future consultations.
export default function DischargeForm({
  patientId,
  draft,
  correctUploadOf,
  onClose,
  onDone,
}: DischargeFormProps) {
  const [step, setStep] = useState<Step>(
    draft ? "edit" : correctUploadOf ? "upload" : "choose",
  );
  const [current, setCurrent] = useState<TreatmentDischarge | undefined>(draft);
  const [closure, setClosure] = useState<ClosureValues>(
    closureFromDraft(draft ?? correctUploadOf),
  );
  const [content, setContent] = useState(contentFromDraft(draft));
  const [file, setFile] = useState<File | null>(null);
  const [uploadDate, setUploadDate] = useState(todayLocal());
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{
    preview: CancellationPreview;
    run: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const profileQuery = useProfile();
  const createDraft = useCreateDischargeDraft(patientId);
  const updateDischarge = useUpdateDischarge();
  const issueDischarge = useIssueDischarge();
  const upload = useUploadDischarge(patientId);
  const correctUpload = useCorrectUploadDischarge();

  // issue() answers 400 without the therapist's RUT, so the generated path is
  // blocked up front. If the profile fails to load the button stays enabled.
  const rutMissing = !!profileQuery.data && !profileQuery.data.rut;

  const setContentField = (key: keyof typeof content, value: string) =>
    setContent((prev) => ({ ...prev, [key]: value }));

  // Asks the server which future consultations the closure would cancel and,
  // if any, requires an explicit confirmation before running `run`.
  const confirmThenRun = async (run: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      const preview = await getCancellationPreview(patientId);
      if (preview.count > 0) {
        setPending({ preview, run });
        return;
      }
      await run();
    } catch (err) {
      setError(getApiErrorMessage(err, "No se pudo completar el cierre"));
    } finally {
      setBusy(false);
    }
  };

  const runConfirmed = async () => {
    if (!pending) return;
    const { run } = pending;
    setPending(null);
    setBusy(true);
    try {
      await run();
    } catch (err) {
      setError(getApiErrorMessage(err, "No se pudo completar el cierre"));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateDraft = async () => {
    const problem = validateClosure(closure);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    try {
      const created = await createDraft.mutateAsync(closureToPayload(closure));
      setCurrent(created);
      setClosure(closureFromDraft(created));
      setContent(contentFromDraft(created));
      setStep("edit");
    } catch (err) {
      setError(getApiErrorMessage(err, "No se pudo crear el borrador"));
    }
  };

  const buildPatch = () => {
    const payload = closureToPayload(closure);
    return {
      closureReason: payload.closureReason,
      dropoutReason: closure.dropoutReason || null,
      dropoutNote: payload.dropoutNote ?? null,
      referralDestination: payload.referralDestination ?? null,
      admissionDate: content.admissionDate,
      dischargeDate: content.dischargeDate,
      sessionCount: Number(content.sessionCount),
      consultReason: content.consultReason,
      diagnosis: content.diagnosis.trim() || null,
      evolutionSummary: content.evolutionSummary,
      statusAtDischarge: content.statusAtDischarge,
      recommendations: content.recommendations,
    };
  };

  const validateEdit = (): string | null => {
    const problem = validateClosure(closure);
    if (problem) return problem;
    if (!content.admissionDate || !content.dischargeDate) {
      return "Las fechas de ingreso y de alta son obligatorias";
    }
    const count = Number(content.sessionCount);
    if (!Number.isInteger(count) || count < 0) {
      return "El número de sesiones debe ser un entero mayor o igual a 0";
    }
    return null;
  };

  const handleSaveDraft = async () => {
    if (!current) return;
    const problem = validateEdit();
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    try {
      await updateDischarge.mutateAsync({ id: current.id, data: buildPatch() });
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, "No se pudo guardar el borrador"));
    }
  };

  const handleIssue = () => {
    if (!current) return;
    const problem = validateEdit();
    if (problem) {
      setError(problem);
      return;
    }
    const id = current.id;
    void confirmThenRun(async () => {
      await updateDischarge.mutateAsync({ id, data: buildPatch() });
      onDone(await issueDischarge.mutateAsync(id));
    });
  };

  const handleUpload = () => {
    const problem = validateClosure(closure);
    if (problem) {
      setError(problem);
      return;
    }
    if (!file) {
      setError("Selecciona el archivo PDF");
      return;
    }
    if (file.type !== "application/pdf") {
      setError("Solo se permite subir un archivo PDF.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setError("El archivo supera el tamaño máximo permitido (25 MB).");
      return;
    }
    if (!uploadDate) {
      setError("La fecha de alta es obligatoria");
      return;
    }
    const data = { ...closureToPayload(closure), file, dischargeDate: uploadDate };
    void confirmThenRun(async () => {
      try {
        const result = correctUploadOf
          ? await correctUpload.mutateAsync({ id: correctUploadOf.id, data })
          : await upload.mutateAsync(data);
        onDone(result);
      } catch (err) {
        setError(getUploadErrorMessage(err));
      }
    });
  };

  const title =
    step === "upload" && correctUploadOf ? "Reemplazar PDF del informe" : "Cierre del tratamiento";

  return (
    <>
      <Modal
        onClose={onClose}
        labelledBy="discharge-form-title"
        className="max-w-lg max-h-[90vh] overflow-y-auto p-6"
      >
        <div className="flex items-start justify-between mb-4">
          <h3 id="discharge-form-title" className="font-display text-xl text-slate-900">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 ml-4"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        {error && <ErrorBanner icon message={error} className="mb-4" />}

        {step === "choose" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Elige cómo quieres emitir el informe de alta.
            </p>
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => setStep("closure")}
            >
              Generar con el sistema
            </button>
            <button
              type="button"
              className="btn-secondary w-full flex items-center justify-center gap-1.5"
              onClick={() => setStep("upload")}
            >
              <FileUp size={14} /> Subir mi propio PDF
            </button>
          </div>
        )}

        {step === "closure" && (
          <div className="space-y-4">
            {rutMissing && <RutWarning />}
            <ClosureFields idPrefix="gen" values={closure} onChange={setClosure} />
            <p className="text-xs text-slate-500">
              El borrador se prellena con los datos de las consultas y podrás editarlo antes de
              emitir.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={createDraft.isPending}
                onClick={() => void handleCreateDraft()}
              >
                {createDraft.isPending ? "Creando..." : "Crear borrador"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setStep("choose")}>
                Volver
              </button>
            </div>
          </div>
        )}

        {step === "edit" && (
          <div className="space-y-4">
            {rutMissing && <RutWarning />}
            <ClosureFields idPrefix="edit" values={closure} onChange={setClosure} />
            <div className="grid grid-cols-2 gap-3">
              <FormField id="dis-admissionDate" label="Fecha de ingreso" required>
                <input
                  id="dis-admissionDate"
                  type="date"
                  className="input-field"
                  value={content.admissionDate}
                  onChange={(e) => setContentField("admissionDate", e.target.value)}
                />
              </FormField>
              <FormField id="dis-dischargeDate" label="Fecha de cierre" required>
                <input
                  id="dis-dischargeDate"
                  type="date"
                  className="input-field"
                  value={content.dischargeDate}
                  onChange={(e) => setContentField("dischargeDate", e.target.value)}
                />
              </FormField>
              <FormField id="dis-sessionCount" label="Sesiones realizadas" required>
                <input
                  id="dis-sessionCount"
                  type="number"
                  min={0}
                  className="input-field"
                  value={content.sessionCount}
                  onChange={(e) => setContentField("sessionCount", e.target.value)}
                />
              </FormField>
            </div>
            <TextArea id="dis-consultReason" label="Motivo de consulta" max={2000}
              value={content.consultReason}
              onChange={(v) => setContentField("consultReason", v)} />
            <TextArea id="dis-diagnosis" label="Diagnóstico (opcional)" max={1000}
              value={content.diagnosis}
              onChange={(v) => setContentField("diagnosis", v)} />
            <TextArea id="dis-evolutionSummary" label="Resumen de la evolución" max={5000}
              value={content.evolutionSummary}
              onChange={(v) => setContentField("evolutionSummary", v)} />
            <TextArea id="dis-statusAtDischarge" label="Estado al cierre" max={2000}
              value={content.statusAtDischarge}
              onChange={(v) => setContentField("statusAtDischarge", v)} />
            <TextArea id="dis-recommendations" label="Recomendaciones" max={3000}
              value={content.recommendations}
              onChange={(v) => setContentField("recommendations", v)} />
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={busy || rutMissing}
                onClick={handleIssue}
              >
                {busy ? "Emitiendo..." : "Emitir informe"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || updateDischarge.isPending}
                onClick={() => void handleSaveDraft()}
              >
                Guardar borrador
              </button>
            </div>
          </div>
        )}

        {step === "upload" && (
          <div className="space-y-4">
            <ClosureFields idPrefix="up" values={closure} onChange={setClosure} />
            <FormField id="dis-uploadDate" label="Fecha de cierre" required>
              <input
                id="dis-uploadDate"
                type="date"
                className="input-field"
                value={uploadDate}
                onChange={(e) => setUploadDate(e.target.value)}
              />
            </FormField>
            <FormField id="dis-file" label="Archivo PDF del informe" required>
              <input
                id="dis-file"
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="block w-full text-sm text-slate-600"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-slate-500 mt-1">
                Solo PDF, hasta 25 MB. El sistema guarda el archivo tal cual y no lo firma: queda
                registrado como documento aportado por el terapeuta.
              </p>
            </FormField>
            <div className="flex gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={handleUpload}
              >
                {busy ? "Subiendo..." : "Subir y cerrar tratamiento"}
              </button>
              {!correctUploadOf && (
                <button type="button" className="btn-secondary" onClick={() => setStep("choose")}>
                  Volver
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {pending && (
        <ConfirmDialog
          title="Se cancelarán consultas futuras"
          message={describeCancellation(pending.preview)}
          confirmLabel="Confirmar cierre"
          onConfirm={() => void runConfirmed()}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}

function RutWarning() {
  return (
    <div role="alert" className="bg-amber-50 border border-amber-200 rounded-lg p-3">
      <p className="text-amber-800 text-sm">
        Falta tu RUT en el perfil. Es obligatorio para emitir el informe generado por el
        sistema.{" "}
        <a href="/profile" className="font-medium underline">
          Completar mi RUT en el perfil
        </a>
      </p>
    </div>
  );
}

function TextArea({
  id,
  label,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  max: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField id={id} label={label}>
      <textarea
        id={id}
        rows={3}
        maxLength={max}
        className="input-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  );
}
