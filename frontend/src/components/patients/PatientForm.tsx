import { X } from "lucide-react";
import ErrorBanner from "../ui/ErrorBanner";
import FormField from "../ui/FormField";
import {
  CONSENT_PURPOSE_LABELS,
  type ConsentPurpose,
  type ConsentStatus,
} from "../../types/patient";

export interface PatientFormValues {
  fullName: string;
  rut: string;
  birthDate: string;
  occupation: string;
  phone: string;
  email: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  treatingPsychiatrist: string;
  treatingDoctor: string;
  // sdd/online-payment-integration PR 3 (T9.7): string en el form state
  // (mismo criterio que el resto de los inputs controlados) -- se convierte
  // a number|undefined recién al armar el payload (CreatePatientPayload).
  defaultSessionAmount: string;
}

interface PatientFormProps {
  form: PatientFormValues;
  onChange: (form: PatientFormValues) => void;
  consents: ConsentStatus;
  onConsentsChange: (consents: ConsentStatus) => void;
  rutError: string;
  onRutChange: (value: string) => void;
  formError: string;
  isPending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

export default function PatientForm({
  form,
  onChange,
  consents,
  onConsentsChange,
  rutError,
  onRutChange,
  formError,
  isPending,
  onSubmit,
  onCancel,
}: PatientFormProps) {
  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-xl text-slate-900">Nueva Ficha</h3>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar">
          <X size={20} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField id="patient-fullName" label="Nombre completo" required>
          <input
            id="patient-fullName"
            className="input-field"
            value={form.fullName}
            onChange={(e) => onChange({ ...form, fullName: e.target.value })}
          />
        </FormField>
        <FormField id="patient-rut" label="RUT" required error={rutError}>
          <input
            id="patient-rut"
            className={`input-field ${rutError ? "border-red-300 focus:ring-red-200" : ""}`}
            placeholder="12.345.678-9"
            value={form.rut}
            onChange={(e) => onRutChange(e.target.value)}
            maxLength={12}
          />
        </FormField>
        <FormField id="patient-birthDate" label="Fecha de nacimiento" required>
          <input
            id="patient-birthDate"
            type="date"
            className="input-field"
            value={form.birthDate}
            onChange={(e) => onChange({ ...form, birthDate: e.target.value })}
          />
        </FormField>
        <FormField id="patient-occupation" label="Ocupación">
          <input
            id="patient-occupation"
            className="input-field"
            value={form.occupation}
            onChange={(e) => onChange({ ...form, occupation: e.target.value })}
          />
        </FormField>
        <FormField id="patient-phone" label="Teléfono">
          <input
            id="patient-phone"
            className="input-field"
            value={form.phone}
            onChange={(e) => onChange({ ...form, phone: e.target.value })}
          />
        </FormField>
        <FormField id="patient-email" label="Email">
          <input
            id="patient-email"
            type="email"
            className="input-field"
            value={form.email}
            onChange={(e) => onChange({ ...form, email: e.target.value })}
          />
        </FormField>
        <FormField id="patient-address" label="Dirección">
          <input
            id="patient-address"
            className="input-field"
            value={form.address}
            onChange={(e) => onChange({ ...form, address: e.target.value })}
          />
        </FormField>
        <FormField id="patient-emergencyContactName" label="Contacto emergencia">
          <input
            id="patient-emergencyContactName"
            className="input-field"
            value={form.emergencyContactName}
            onChange={(e) => onChange({ ...form, emergencyContactName: e.target.value })}
          />
        </FormField>
        <FormField id="patient-emergencyContactPhone" label="Teléfono emergencia">
          <input
            id="patient-emergencyContactPhone"
            className="input-field"
            value={form.emergencyContactPhone}
            onChange={(e) => onChange({ ...form, emergencyContactPhone: e.target.value })}
          />
        </FormField>
        <FormField id="patient-treatingPsychiatrist" label="Psiquiatra tratante">
          <input
            id="patient-treatingPsychiatrist"
            className="input-field"
            value={form.treatingPsychiatrist}
            onChange={(e) => onChange({ ...form, treatingPsychiatrist: e.target.value })}
          />
        </FormField>
        <FormField id="patient-defaultSessionAmount" label="Monto de sesión por defecto (CLP)">
          <input
            id="patient-defaultSessionAmount"
            type="number"
            min="0"
            step="1"
            className="input-field"
            placeholder="Sin cobro automático"
            value={form.defaultSessionAmount}
            onChange={(e) => onChange({ ...form, defaultSessionAmount: e.target.value })}
          />
        </FormField>
        <div className="flex flex-wrap items-center gap-6 pt-2">
          {(Object.keys(CONSENT_PURPOSE_LABELS) as ConsentPurpose[]).map((purpose) => (
            <label
              key={purpose}
              className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={consents[purpose]}
                onChange={(e) =>
                  onConsentsChange({ ...consents, [purpose]: e.target.checked })
                }
                className="rounded"
              />
              {CONSENT_PURPOSE_LABELS[purpose]}
            </label>
          ))}
        </div>
      </div>
      {formError && <ErrorBanner icon message={formError} className="mt-4" />}
      <div className="flex gap-3 mt-6">
        <button type="submit" className="btn-primary" disabled={isPending}>
          {isPending ? "Guardando..." : "Guardar ficha"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancelar
        </button>
      </div>
      </form>
    </div>
  );
}
