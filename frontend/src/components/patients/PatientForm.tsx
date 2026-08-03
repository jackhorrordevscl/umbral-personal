import { AlertCircle, X } from "lucide-react";
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
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
          <X size={20} />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Nombre completo *
          </label>
          <input
            className="input-field"
            value={form.fullName}
            onChange={(e) => onChange({ ...form, fullName: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">RUT *</label>
          <input
            className={`input-field ${rutError ? "border-red-300 focus:ring-red-200" : ""}`}
            placeholder="12.345.678-9"
            value={form.rut}
            onChange={(e) => onRutChange(e.target.value)}
            maxLength={12}
          />
          {rutError && (
            <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
              <AlertCircle size={11} /> {rutError}
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Fecha de nacimiento *
          </label>
          <input
            type="date"
            className="input-field"
            value={form.birthDate}
            onChange={(e) => onChange({ ...form, birthDate: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Ocupación</label>
          <input
            className="input-field"
            value={form.occupation}
            onChange={(e) => onChange({ ...form, occupation: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
          <input
            className="input-field"
            value={form.phone}
            onChange={(e) => onChange({ ...form, phone: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
          <input
            type="email"
            className="input-field"
            value={form.email}
            onChange={(e) => onChange({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Dirección</label>
          <input
            className="input-field"
            value={form.address}
            onChange={(e) => onChange({ ...form, address: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Contacto emergencia
          </label>
          <input
            className="input-field"
            value={form.emergencyContactName}
            onChange={(e) => onChange({ ...form, emergencyContactName: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Teléfono emergencia
          </label>
          <input
            className="input-field"
            value={form.emergencyContactPhone}
            onChange={(e) => onChange({ ...form, emergencyContactPhone: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Psiquiatra tratante
          </label>
          <input
            className="input-field"
            value={form.treatingPsychiatrist}
            onChange={(e) => onChange({ ...form, treatingPsychiatrist: e.target.value })}
          />
        </div>
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
      {formError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-4 flex items-center gap-2">
          <AlertCircle size={14} className="text-red-500 shrink-0" />
          <p className="text-red-600 text-sm">{formError}</p>
        </div>
      )}
      <div className="flex gap-3 mt-6">
        <button onClick={onSubmit} className="btn-primary" disabled={isPending}>
          {isPending ? "Guardando..." : "Guardar ficha"}
        </button>
        <button onClick={onCancel} className="btn-secondary">
          Cancelar
        </button>
      </div>
    </div>
  );
}
