import { useState } from "react";
import ErrorBanner from "../ui/ErrorBanner";
import FormField from "../ui/FormField";
import {
  CUSTODY_LABELS,
  GUARDIAN_RELATIONSHIP_LABELS,
  type CustodyType,
  type GuardianRelationship,
  type LegalGuardian,
} from "../../types/patient";
import type { GuardianPayload } from "../../api/patients";
import { formatRut, normalizeRut, validateRut } from "../../utils/rut";

interface GuardianFormProps {
  /** Con `initial` el formulario edita; sin él, crea. */
  initial?: LegalGuardian;
  isPending: boolean;
  /** Error del servidor (ej. 409) mostrado sobre los botones. */
  error?: string;
  onSubmit: (payload: GuardianPayload) => void;
  onCancel: () => void;
}

const FLAG_FIELDS = [
  ["canConsent", "Puede otorgar consentimiento"],
  ["receivesCommunications", "Recibe comunicaciones"],
  ["canAccessReports", "Puede acceder a informes"],
  ["isPayer", "Es el pagador"],
  ["hasConflict", "Hay conflicto entre los representantes"],
] as const;

type FlagKey = (typeof FLAG_FIELDS)[number][0];

export default function GuardianForm({
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
}: GuardianFormProps) {
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [rut, setRut] = useState(initial ? formatRut(initial.rut) : "");
  const [relationship, setRelationship] = useState<GuardianRelationship>(
    initial?.relationship ?? "MOTHER",
  );
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [custody, setCustody] = useState<CustodyType>(
    initial?.custody ?? "UNKNOWN",
  );
  // Defaults del servidor: canConsent, receivesCommunications y canAccessReports
  // en true; isPayer y hasConflict en false.
  const [flags, setFlags] = useState<Record<FlagKey, boolean>>({
    canConsent: initial?.canConsent ?? true,
    receivesCommunications: initial?.receivesCommunications ?? true,
    canAccessReports: initial?.canAccessReports ?? true,
    isPayer: initial?.isPayer ?? false,
    hasConflict: initial?.hasConflict ?? false,
  });
  const [errors, setErrors] = useState<{ fullName?: string; rut?: string }>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: { fullName?: string; rut?: string } = {};
    if (!fullName.trim()) next.fullName = "El nombre es obligatorio";
    if (!rut.trim()) next.rut = "El RUT es obligatorio";
    else if (!validateRut(rut)) next.rut = "RUT inválido";
    setErrors(next);
    if (next.fullName || next.rut) return;

    onSubmit({
      fullName: fullName.trim(),
      rut: normalizeRut(rut),
      relationship,
      email: email.trim(),
      phone: phone.trim(),
      custody,
      ...flags,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={
        initial ? "Editar representante legal" : "Agregar representante legal"
      }
      className="space-y-3 border border-slate-200 rounded-xl p-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FormField
          id="guardian-fullName"
          label="Nombre completo"
          required
          error={errors.fullName}
        >
          <input
            id="guardian-fullName"
            className="input-field"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </FormField>
        <FormField id="guardian-rut" label="RUT" required error={errors.rut}>
          <input
            id="guardian-rut"
            className="input-field"
            placeholder="12.345.678-9"
            maxLength={12}
            value={rut}
            onChange={(e) => setRut(formatRut(e.target.value))}
          />
        </FormField>
        <FormField
          id="guardian-relationship"
          label="Relación con el paciente"
          required
        >
          <select
            id="guardian-relationship"
            className="input-field"
            value={relationship}
            onChange={(e) =>
              setRelationship(e.target.value as GuardianRelationship)
            }
          >
            {(
              Object.keys(
                GUARDIAN_RELATIONSHIP_LABELS,
              ) as GuardianRelationship[]
            ).map((key) => (
              <option key={key} value={key}>
                {GUARDIAN_RELATIONSHIP_LABELS[key]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="guardian-custody" label="Cuidado personal">
          <select
            id="guardian-custody"
            className="input-field"
            value={custody}
            onChange={(e) => setCustody(e.target.value as CustodyType)}
          >
            {(Object.keys(CUSTODY_LABELS) as CustodyType[]).map((key) => (
              <option key={key} value={key}>
                {CUSTODY_LABELS[key]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="guardian-email" label="Email">
          <input
            id="guardian-email"
            type="email"
            className="input-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        <FormField id="guardian-phone" label="Teléfono">
          <input
            id="guardian-phone"
            className="input-field"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </FormField>
      </div>

      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-slate-600 mb-1">
          Permisos y avisos
        </legend>
        {FLAG_FIELDS.map(([key, label]) => (
          <label
            key={key}
            className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer"
          >
            <input
              type="checkbox"
              className="rounded"
              checked={flags[key]}
              onChange={(e) => setFlags({ ...flags, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {error && <ErrorBanner icon message={error} />}
      <div className="flex gap-3">
        <button
          type="submit"
          className="btn-primary text-sm"
          disabled={isPending}
        >
          {isPending
            ? "Guardando..."
            : initial
              ? "Guardar cambios"
              : "Agregar representante"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary text-sm"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
