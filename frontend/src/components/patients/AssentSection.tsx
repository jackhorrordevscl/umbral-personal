import { useState } from "react";
import { AlertCircle } from "lucide-react";
import ErrorBanner from "../ui/ErrorBanner";
import FormField from "../ui/FormField";
import {
  ASSENT_ACTION_LABELS,
  type AgeBand,
  type AssentAction,
} from "../../types/patient";
import { useAssents, useRecordAssent } from "../../hooks/useAssents";
import { getApiErrorMessage } from "../../utils/api-error";
import { formatChileShortDateTime } from "../../utils/datetime";

export const ASSENT_NOTE_MAX = 500;

const BAND_HINTS: Partial<Record<AgeBand, string>> = {
  UNDER_14: "Menor de 14 años: debe constar que fue informado y oído.",
  AGE_14_17: "De 14 a 17 años: debe constar su asentimiento expreso.",
};

interface AssentSectionProps {
  patientId: string;
  ageBand?: AgeBand;
}

// Bloque Menores (M5): registro append-only del asentimiento del menor. Un
// rechazo avisa al terapeuta, pero no bloquea nada (política del producto).
export default function AssentSection({
  patientId,
  ageBand,
}: AssentSectionProps) {
  const assentsQuery = useAssents(patientId);
  const recordAssent = useRecordAssent(patientId);
  const [action, setAction] = useState<AssentAction>("INFORMED_AND_HEARD");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const assents = assentsQuery.data ?? [];
  const latest = assents[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length > ASSENT_NOTE_MAX) {
      setError(`La nota no puede superar los ${ASSENT_NOTE_MAX} caracteres`);
      return;
    }
    setError("");
    recordAssent.mutate(
      { action, ...(trimmed ? { note: trimmed } : {}) },
      {
        onSuccess: () => setNote(""),
        onError: (err) =>
          setError(
            getApiErrorMessage(err, "No se pudo registrar el asentimiento"),
          ),
      },
    );
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <p className="font-medium text-slate-700 text-sm mb-1">
        Asentimiento del menor
      </p>
      {ageBand && BAND_HINTS[ageBand] && (
        <p className="text-xs text-slate-500 mb-3">{BAND_HINTS[ageBand]}</p>
      )}

      {latest?.action === "REFUSED" && (
        <div
          role="alert"
          className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2 mb-3"
        >
          <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-amber-700 text-xs">
            El último registro indica que el paciente rechazó el tratamiento.
            Conviene revisarlo con el paciente y su representante antes de
            continuar. Esto no bloquea la ficha.
          </p>
        </div>
      )}

      {assentsQuery.isError && (
        <p className="text-red-500 text-xs mb-3 flex items-center gap-1">
          <AlertCircle size={11} /> No se pudo cargar el registro de
          asentimiento.
        </p>
      )}
      {assentsQuery.isLoading ? (
        <p className="text-xs text-slate-500">Cargando...</p>
      ) : assents.length === 0 ? (
        assentsQuery.isError ? null : (
          <p className="text-xs text-slate-500 mb-3">
            Sin registros de asentimiento.
          </p>
        )
      ) : (
        <ul className="space-y-2 mb-3">
          {assents.map((a) => (
            <li
              key={a.id}
              className="bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-600"
            >
              <p className="font-medium text-slate-700">
                {ASSENT_ACTION_LABELS[a.action]}
              </p>
              <p>
                {formatChileShortDateTime(a.recordedAt)}
                {a.recordedBy ? ` · ${a.recordedBy.name}` : ""}
              </p>
              {a.note && <p className="italic">"{a.note}"</p>}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={handleSubmit}
        aria-label="Registrar asentimiento"
        className="space-y-3"
      >
        <FormField id="assent-action" label="Registro">
          <select
            id="assent-action"
            className="input-field text-sm"
            value={action}
            onChange={(e) => setAction(e.target.value as AssentAction)}
          >
            {(Object.keys(ASSENT_ACTION_LABELS) as AssentAction[]).map(
              (key) => (
                <option key={key} value={key}>
                  {ASSENT_ACTION_LABELS[key]}
                </option>
              ),
            )}
          </select>
        </FormField>
        {action === "REFUSED" && (
          <p className="text-xs text-amber-700">
            Registrar un rechazo deja constancia y avisa al terapeuta; no impide
            continuar.
          </p>
        )}
        <FormField id="assent-note" label="Nota (opcional)">
          <textarea
            id="assent-note"
            className="input-field resize-none"
            rows={2}
            maxLength={ASSENT_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-xs text-slate-500 mt-1">
            No incluyas datos clínicos ni sensibles.
          </p>
        </FormField>
        {error && <ErrorBanner icon message={error} />}
        <button
          type="submit"
          className="btn-secondary text-xs py-1.5"
          disabled={recordAssent.isPending}
        >
          {recordAssent.isPending ? "Registrando..." : "Registrar asentimiento"}
        </button>
      </form>
    </div>
  );
}
