import { AlertCircle } from "lucide-react";
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";

interface FormFieldProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  /** Clases del wrapper (ej. "md:col-span-2" para campos anchos). */
  className?: string;
  children: ReactNode;
}

interface ControlProps {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
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
  const errorId = `${useId()}-error`;

  // #298: enlaza el control (el elemento cuyo id coincide) con su mensaje de
  // error mediante aria-invalid + aria-describedby, sin que cada uso lo cablee
  // a mano. Busca también dentro de wrappers (ej. input + ícono, #356).
  // Children.map se usa siempre (también sin error) para que las keys de los
  // hijos no cambien al aparecer/desaparecer el error: si cambiaran, el input
  // se remontaría y perdería el foco mientras el usuario escribe.
  const wire = (node: ReactNode): ReactNode => {
    if (!isValidElement<ControlProps & { children?: ReactNode }>(node))
      return node;
    if (node.props.id === id) {
      if (!error) return node;
      const describedBy = [node.props["aria-describedby"], errorId]
        .filter(Boolean)
        .join(" ");
      return cloneElement(node as ReactElement<ControlProps>, {
        "aria-invalid": true,
        "aria-describedby": describedBy,
      });
    }
    const nested = node.props.children;
    if (typeof nested === "function" || nested == null) return node;
    return cloneElement(node, undefined, Children.map(nested, wire));
  };
  const content = Children.map(children, wire);

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-slate-600 mb-1"
      >
        {label}
        {required && " *"}
      </label>
      {content}
      {error && (
        <p
          id={errorId}
          className="text-red-500 text-xs mt-1 flex items-center gap-1"
        >
          <AlertCircle size={11} /> {error}
        </p>
      )}
    </div>
  );
}
