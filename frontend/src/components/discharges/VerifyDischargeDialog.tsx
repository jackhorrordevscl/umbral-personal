import { X } from "lucide-react";
import Modal from "../ui/Modal";
import ErrorBanner from "../ui/ErrorBanner";
import { useVerifyDischarge } from "../../hooks/useDischarges";
import type { DischargeVerification } from "../../types/discharge";
import { formatChileShortDateTime } from "../../utils/datetime";

interface VerifyDischargeDialogProps {
  dischargeId: string;
  onClose: () => void;
}

function pdfMessage(pdf: DischargeVerification["pdf"]): { text: string; ok: boolean } {
  if (!pdf.present) return { text: "Esta versión no tiene un PDF asociado.", ok: false };
  if (pdf.intact === true) {
    return { text: "El PDF guardado coincide con su huella digital (SHA-256).", ok: true };
  }
  if (pdf.intact === false) {
    return { text: "El PDF guardado no coincide con su huella digital (SHA-256).", ok: false };
  }
  return { text: "No se pudo comprobar la integridad del PDF guardado.", ok: false };
}

// Verification of an issued report. For a PDF the therapist supplied the
// wording must never suggest that the system signed or certified it.
export default function VerifyDischargeDialog({
  dischargeId,
  onClose,
}: VerifyDischargeDialogProps) {
  const query = useVerifyDischarge(dischargeId);
  const result = query.data;
  const pdf = result ? pdfMessage(result.pdf) : null;

  return (
    <Modal
      onClose={onClose}
      labelledBy="verify-discharge-title"
      className="max-w-md p-6"
    >
      <div className="flex items-start justify-between mb-4">
        <h3 id="verify-discharge-title" className="font-display text-xl text-slate-900">
          Verificación del informe
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

      {query.isLoading && (
        <p role="status" className="text-sm text-slate-500">
          Verificando...
        </p>
      )}
      {query.isError && (
        <ErrorBanner icon message="No se pudo verificar el informe." onRetry={() => void query.refetch()} />
      )}

      {result && pdf && (
        <div role="status" className="space-y-3 text-sm text-slate-700">
          <p className={result.valid ? "text-emerald-700" : "text-red-600"}>
            {result.valid
              ? "El registro del informe coincide con su huella digital."
              : "El registro del informe no coincide con su huella digital."}
          </p>
          <p className={pdf.ok ? "text-emerald-700" : "text-amber-700"}>{pdf.text}</p>
          {result.providedByTherapist || result.source === "UPLOADED" ? (
            <p className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600">
              Documento aportado por el terapeuta. El sistema registra su huella para detectar
              cambios posteriores, pero no lo firma ni certifica su contenido.
            </p>
          ) : (
            <p className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600">
              Informe generado por el sistema a partir de los datos ingresados por el terapeuta.
            </p>
          )}
          <dl className="text-xs text-slate-600 space-y-1">
            <div className="flex gap-1">
              <dt className="font-medium">Versión:</dt>
              <dd>
                {result.version}
                {result.isCurrent ? " (vigente)" : " (existe una versión posterior)"}
              </dd>
            </div>
            {result.issuedAt && (
              <div className="flex gap-1">
                <dt className="font-medium">Emitido:</dt>
                <dd>{formatChileShortDateTime(result.issuedAt)}</dd>
              </div>
            )}
            {result.contentHash && (
              <div>
                <dt className="font-medium">Huella:</dt>
                <dd className="font-mono break-all">{result.contentHash}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      <div className="mt-6">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
