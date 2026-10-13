import FormField from "../ui/FormField";
import type { ClosureValues } from "./closure";
import {
  CLOSURE_REASONS,
  DROPOUT_REASON_LABELS,
  TREATMENT_STATUS_LABELS,
  type ClosureReason,
  type DropoutReason,
} from "../../types/discharge";

// Same limits as the backend DTO (DISCHARGE_LIMITS).
const DROPOUT_NOTE_MAX = 200;
const REFERRAL_DESTINATION_MAX = 120;

interface ClosureFieldsProps {
  idPrefix: string;
  values: ClosureValues;
  onChange: (values: ClosureValues) => void;
}

// Shared by the "generate" and "upload my own PDF" paths: why the treatment
// closes and, for dropouts, the closed-list reason.
export default function ClosureFields({ idPrefix, values, onChange }: ClosureFieldsProps) {
  const set = (patch: Partial<ClosureValues>) => onChange({ ...values, ...patch });
  const reasonId = `${idPrefix}-closureReason`;
  const dropoutId = `${idPrefix}-dropoutReason`;
  const noteId = `${idPrefix}-dropoutNote`;
  const destinationId = `${idPrefix}-referralDestination`;

  return (
    <div className="space-y-3">
      <FormField id={reasonId} label="Motivo del cierre" required>
        <select
          id={reasonId}
          className="input-field"
          value={values.closureReason}
          onChange={(e) => {
            const closureReason = e.target.value as ClosureReason;
            // Dropout and referral fields only apply to their own closure.
            set({
              closureReason,
              dropoutReason: closureReason === "DROPPED_OUT" ? values.dropoutReason : "",
              dropoutNote: closureReason === "DROPPED_OUT" ? values.dropoutNote : "",
              referralDestination:
                closureReason === "REFERRED" ? values.referralDestination : "",
            });
          }}
        >
          {CLOSURE_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {TREATMENT_STATUS_LABELS[reason]}
            </option>
          ))}
        </select>
      </FormField>

      {values.closureReason === "DROPPED_OUT" && (
        <>
          <FormField id={dropoutId} label="Motivo principal de la deserción" required>
            <select
              id={dropoutId}
              className="input-field"
              value={values.dropoutReason}
              onChange={(e) =>
                set({
                  dropoutReason: e.target.value as DropoutReason | "",
                  dropoutNote: e.target.value === "OTHER" ? values.dropoutNote : "",
                })
              }
            >
              <option value="">Seleccionar motivo...</option>
              {(Object.keys(DROPOUT_REASON_LABELS) as DropoutReason[]).map((reason) => (
                <option key={reason} value={reason}>
                  {DROPOUT_REASON_LABELS[reason]}
                </option>
              ))}
            </select>
          </FormField>
          {values.dropoutReason === "OTHER" && (
            <FormField id={noteId} label="Detalle breve del motivo" required>
              <input
                id={noteId}
                className="input-field"
                maxLength={DROPOUT_NOTE_MAX}
                aria-describedby={`${noteId}-hint`}
                value={values.dropoutNote}
                onChange={(e) => set({ dropoutNote: e.target.value })}
              />
              <p id={`${noteId}-hint`} className="text-xs text-slate-500 mt-1">
                No incluir datos sensibles. Máximo {DROPOUT_NOTE_MAX} caracteres.
              </p>
            </FormField>
          )}
        </>
      )}

      {values.closureReason === "REFERRED" && (
        <FormField id={destinationId} label="Destino de la derivación (opcional)">
          <input
            id={destinationId}
            className="input-field"
            maxLength={REFERRAL_DESTINATION_MAX}
            aria-describedby={`${destinationId}-hint`}
            value={values.referralDestination}
            onChange={(e) => set({ referralDestination: e.target.value })}
          />
          <p id={`${destinationId}-hint`} className="text-xs text-slate-500 mt-1">
            No incluir datos sensibles.
          </p>
        </FormField>
      )}
    </div>
  );
}
