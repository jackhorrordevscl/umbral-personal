import type { TreatmentStatus } from "../../types/patient";
import { TREATMENT_STATUS_LABELS } from "../../types/discharge";

const STYLES: Record<TreatmentStatus, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  DISCHARGED: "bg-slate-100 text-slate-600",
  REFERRED: "bg-blue-50 text-blue-700",
  DROPPED_OUT: "bg-amber-50 text-amber-700",
};

// Informe de alta (T5b): estado del tratamiento del paciente.
export default function TreatmentStatusBadge({ status }: { status?: TreatmentStatus }) {
  if (!status) return null;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${STYLES[status]}`}>
      {TREATMENT_STATUS_LABELS[status]}
    </span>
  );
}
