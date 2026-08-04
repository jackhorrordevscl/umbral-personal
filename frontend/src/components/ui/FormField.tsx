import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

interface FormFieldProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  /** Clases del wrapper (ej. "md:col-span-2" para campos anchos). */
  className?: string;
  children: ReactNode;
}

// #73 (punto 5): el par label+input (misma clase de label, mismo layout de
// error con ícono) estaba copiado campo por campo en PatientForm, la
// pestaña de edición de PatientModal, y el par crear/corregir de
// ConsultationsPage.
export default function FormField({
  id,
  label,
  required,
  error,
  className = "",
  children,
}: FormFieldProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">
        {label}
        {required && " *"}
      </label>
      {children}
      {error && (
        <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </p>
      )}
    </div>
  );
}
