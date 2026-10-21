import { useState } from "react";
import { Download, FileCheck2, Pencil, Plus, ShieldCheck } from "lucide-react";
import ErrorBanner from "../ui/ErrorBanner";
import DischargeForm from "./DischargeForm";
import VerifyDischargeDialog from "./VerifyDischargeDialog";
import DeliverySection from "./DeliverySection";
import { downloadDischargePdf } from "../../api/discharges";
import { useCorrectDischarge, useDischarges } from "../../hooks/useDischarges";
import {
  DISCHARGE_SOURCE_LABELS,
  TREATMENT_STATUS_LABELS,
  type IssueDischargeResult,
  type TreatmentDischarge,
} from "../../types/discharge";
import type { TreatmentStatus } from "../../types/patient";
import { downloadBlob } from "../../utils/download";
import { getApiErrorMessage } from "../../utils/api-error";
import { formatCalendarDate, formatChileShortDateTime } from "../../utils/datetime";

interface DischargeSectionProps {
  patientId: string;
  treatmentStatus?: TreatmentStatus;
  /** A un NNA el informe se entrega a su representante, no a él. */
  isMinor?: boolean;
  /** Called after a closure is issued (the open record refreshes its status). */
  onChanged?: () => void;
}

type FormState =
  | { kind: "new" }
  | { kind: "draft"; draft: TreatmentDischarge }
  | { kind: "correct-upload"; of: TreatmentDischarge };

// Informe de alta (T5b): versions of the closure report for one patient.
export default function DischargeSection({
  patientId,
  treatmentStatus,
  isMinor = false,
  onChanged,
}: DischargeSectionProps) {
  const dischargesQuery = useDischarges(patientId);
  const correct = useCorrectDischarge();
  const [form, setForm] = useState<FormState | null>(null);
  const [verifyId, setVerifyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Más reciente primero: ordenar por versión mezclaría los grupos de un
  // tratamiento reabierto (el grupo nuevo vuelve a empezar en la versión 1).
  const discharges = [...(dischargesQuery.data ?? [])].sort(
    (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.version - a.version,
  );
  const correctedIds = new Set(discharges.map((d) => d.correctsId).filter(Boolean));
  const hasDraft = discharges.some((d) => d.status === "DRAFT");
  // Con el paciente de vuelta en tratamiento, los informes emitidos describen un
  // cierre ya reabierto: quedan como histórico y no se corrigen (issue #447).
  const isReopened = treatmentStatus === "ACTIVE";
  // Sin la lista no se sabe si ya hay un borrador: no se ofrece iniciar un alta.
  const canStart =
    (treatmentStatus ?? "ACTIVE") === "ACTIVE" &&
    !hasDraft &&
    !dischargesQuery.isError &&
    !dischargesQuery.isLoading;

  const handleDownload = async (d: TreatmentDischarge) => {
    setError("");
    try {
      const blob = await downloadDischargePdf(d.id);
      downloadBlob(blob, `informe-alta-v${d.version}.pdf`);
    } catch (err) {
      setError(getApiErrorMessage(err, "No se pudo descargar el PDF"));
    }
  };

  const handleCorrect = (d: TreatmentDischarge) => {
    setError("");
    setNotice("");
    if (d.source === "UPLOADED") {
      setForm({ kind: "correct-upload", of: d });
      return;
    }
    correct.mutate(d.id, {
      onSuccess: (draft) => setForm({ kind: "draft", draft }),
      onError: (err) => setError(getApiErrorMessage(err, "No se pudo crear la corrección")),
    });
  };

  const handleDone = (result: IssueDischargeResult) => {
    setForm(null);
    const n = result.cancelledConsultations;
    setNotice(
      n > 0
        ? `Informe emitido. Se cancelaron ${n} ${n === 1 ? "consulta futura" : "consultas futuras"}.`
        : "Informe emitido.",
    );
    onChanged?.();
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <p className="font-medium text-slate-700 text-sm">Cierre del tratamiento</p>
        {canStart && (
          <button
            type="button"
            onClick={() => {
              setNotice("");
              setForm({ kind: "new" });
            }}
            className="btn-secondary text-xs py-1 flex items-center gap-1"
          >
            <Plus size={12} /> Dar de alta
          </button>
        )}
      </div>

      {error && <ErrorBanner icon message={error} className="mb-3" />}
      {notice && (
        <p
          role="status"
          className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-700 text-sm mb-3"
        >
          {notice}
        </p>
      )}
      {dischargesQuery.isError && (
        <ErrorBanner
          icon
          message="No se pudieron cargar los informes de alta."
          onRetry={() => void dischargesQuery.refetch()}
          className="mb-3"
        />
      )}

      {dischargesQuery.isLoading ? (
        <p className="text-xs text-slate-500">Cargando...</p>
      ) : discharges.length === 0 ? (
        dischargesQuery.isError ? null : (
          <p className="text-xs text-slate-500">Sin informes de alta.</p>
        )
      ) : (
        <ul className="space-y-2">
          {discharges.map((d) => {
            const isIssued = d.status === "ISSUED";
            const isCurrent = isIssued && !correctedIds.has(d.id);
            return (
              <li key={d.id} className="bg-slate-50 rounded-lg px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-xs text-slate-600 space-y-0.5">
                    <p className="font-medium text-slate-700 flex items-center gap-1">
                      <FileCheck2 size={12} />
                      Versión {d.version} · {TREATMENT_STATUS_LABELS[d.closureReason]}
                    </p>
                    <p>
                      {isIssued ? "Emitido" : "Borrador"} · {DISCHARGE_SOURCE_LABELS[d.source]}
                      {d.issuedAt ? ` · ${formatChileShortDateTime(d.issuedAt)}` : ""}
                    </p>
                    <p>Fecha de cierre: {formatCalendarDate(d.dischargeDate)}</p>
                    {isIssued && !isCurrent && <p className="text-slate-500">Reemplazada</p>}
                    {isCurrent && isReopened && (
                      <p className="text-slate-500">Histórico · Paciente reabierto</p>
                    )}
                  </div>
                  <div className="flex items-center shrink-0">
                    {d.status === "DRAFT" && (
                      <button
                        type="button"
                        onClick={() => setForm({ kind: "draft", draft: d })}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500"
                        aria-label={`Continuar el borrador de la versión ${d.version}`}
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                    {isIssued && d.documentId && (
                      <button
                        type="button"
                        onClick={() => void handleDownload(d)}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500"
                        aria-label={`Descargar el PDF de la versión ${d.version}`}
                      >
                        <Download size={13} />
                      </button>
                    )}
                    {isIssued && (
                      <button
                        type="button"
                        onClick={() => setVerifyId(d.id)}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500"
                        aria-label={`Verificar la versión ${d.version}`}
                      >
                        <ShieldCheck size={13} />
                      </button>
                    )}
                  </div>
                </div>
                {isIssued && (
                  <DeliverySection dischargeId={d.id} patientId={patientId} isMinor={isMinor} />
                )}
                {isCurrent && !hasDraft && !isReopened && (
                  <button
                    type="button"
                    disabled={correct.isPending}
                    onClick={() => handleCorrect(d)}
                    className="btn-secondary text-xs py-1 mt-2"
                  >
                    Corregir
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {form && (
        <DischargeForm
          patientId={patientId}
          draft={form.kind === "draft" ? form.draft : undefined}
          correctUploadOf={form.kind === "correct-upload" ? form.of : undefined}
          onClose={() => setForm(null)}
          onDone={handleDone}
        />
      )}
      {verifyId && (
        <VerifyDischargeDialog dischargeId={verifyId} onClose={() => setVerifyId(null)} />
      )}
    </div>
  );
}
