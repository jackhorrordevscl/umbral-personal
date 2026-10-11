import { AlertCircle } from "lucide-react";
import type { MinorStatus } from "../../types/patient";
import { formatCalendarDate } from "../../utils/datetime";

// Respaldo si el backend no envía la fecha (MINOR_GUARDIAN_ENFORCEMENT_DATE).
export const DEFAULT_GUARDIAN_ENFORCEMENT_DATE = "2026-12-01";

interface MinorStatusAlertProps {
  minorStatus?: MinorStatus;
  enforcementDate?: string;
}

// Bloque Menores (M5): aviso de regularización. Solo aparece cuando falta el
// representante o el consentimiento vigente es legado (otorgado por el
// paciente). Mismo estilo ámbar que los avisos de la ficha.
export default function MinorStatusAlert({
  minorStatus,
  enforcementDate = DEFAULT_GUARDIAN_ENFORCEMENT_DATE,
}: MinorStatusAlertProps) {
  if (minorStatus !== "MISSING_GUARDIAN" && minorStatus !== "LEGACY_CONSENT")
    return null;

  const deadline = formatCalendarDate(enforcementDate);
  const message =
    minorStatus === "MISSING_GUARDIAN"
      ? `Este paciente es menor de edad y no tiene un representante legal con facultad para consentir. Debe registrarse antes del ${deadline}: desde esa fecha no se podrán agendar consultas sin él.`
      : `El consentimiento vigente de este paciente menor de edad fue otorgado por él mismo. Debe registrarse un nuevo consentimiento otorgado por su representante legal antes del ${deadline}.`;

  return (
    <div
      role="alert"
      className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2"
    >
      <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
      <p className="text-amber-700 text-xs">{message}</p>
    </div>
  );
}
