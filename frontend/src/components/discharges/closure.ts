import axios from "axios";
import type { ClosureReason, DropoutReason } from "../../types/discharge";
import { getApiErrorMessage } from "../../utils/api-error";

export interface ClosureValues {
  closureReason: ClosureReason;
  dropoutReason: DropoutReason | "";
  dropoutNote: string;
  referralDestination: string;
}

export const EMPTY_CLOSURE: ClosureValues = {
  closureReason: "DISCHARGED",
  dropoutReason: "",
  dropoutNote: "",
  referralDestination: "",
};

// Returns an error message when the closure is incomplete.
export function validateClosure(values: ClosureValues): string | null {
  if (values.closureReason === "DROPPED_OUT") {
    if (!values.dropoutReason) return "Selecciona el motivo principal de la deserción";
    if (values.dropoutReason === "OTHER" && !values.dropoutNote.trim()) {
      return "Indica un detalle breve del motivo";
    }
  }
  return null;
}

export function closureToPayload(values: ClosureValues) {
  return {
    closureReason: values.closureReason,
    ...(values.dropoutReason ? { dropoutReason: values.dropoutReason } : {}),
    ...(values.dropoutNote.trim() ? { dropoutNote: values.dropoutNote.trim() } : {}),
    ...(values.referralDestination.trim()
      ? { referralDestination: values.referralDestination.trim() }
      : {}),
  };
}

export function getUploadErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err) && err.response?.status === 413) {
    return "El archivo supera el tamaño máximo permitido (25 MB).";
  }
  return getApiErrorMessage(err, "No se pudo subir el archivo. Debe ser un PDF válido.");
}
