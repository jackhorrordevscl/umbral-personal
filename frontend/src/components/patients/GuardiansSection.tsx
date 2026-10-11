import { useState } from "react";
import { AlertCircle, Pencil, Plus, Trash2 } from "lucide-react";
import ConfirmDialog from "../ui/ConfirmDialog";
import ErrorBanner from "../ui/ErrorBanner";
import GuardianForm from "./GuardianForm";
import {
  CUSTODY_LABELS,
  GUARDIAN_RELATIONSHIP_LABELS,
  type LegalGuardian,
} from "../../types/patient";
import type { GuardianPayload } from "../../api/patients";
import {
  useCreateGuardian,
  useDeleteGuardian,
  useGuardians,
  useUpdateGuardian,
} from "../../hooks/useGuardians";
import { getApiErrorMessage } from "../../utils/api-error";
import { formatRut } from "../../utils/rut";

export const MAX_GUARDIANS = 2;

interface GuardiansSectionProps {
  patientId: string;
  /** Se invoca tras agregar, editar o quitar (la ficha abierta refresca su estado). */
  onChanged?: () => void;
}

// Bloque Menores (M5): representantes legales del paciente (hasta 2).
export default function GuardiansSection({
  patientId,
  onChanged,
}: GuardiansSectionProps) {
  const guardiansQuery = useGuardians(patientId);
  const createGuardian = useCreateGuardian(patientId);
  const updateGuardian = useUpdateGuardian(patientId);
  const deleteGuardian = useDeleteGuardian(patientId);

  // "new" = formulario de alta; un id = edición de ese representante.
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [formError, setFormError] = useState("");
  const [listError, setListError] = useState("");
  const [toDelete, setToDelete] = useState<LegalGuardian | null>(null);

  const guardians = guardiansQuery.data ?? [];
  const canAdd = guardians.length < MAX_GUARDIANS;
  const editingGuardian = guardians.find((g) => g.id === editing);

  const closeForm = () => {
    setEditing(null);
    setFormError("");
  };

  const handleSubmit = (payload: GuardianPayload) => {
    setFormError("");
    const options = {
      onSuccess: () => {
        closeForm();
        onChanged?.();
      },
      onError: (err: unknown) =>
        setFormError(
          getApiErrorMessage(err, "No se pudo guardar el representante"),
        ),
    };
    if (editingGuardian) {
      updateGuardian.mutate(
        { guardianId: editingGuardian.id, data: payload },
        options,
      );
    } else {
      createGuardian.mutate(payload, options);
    }
  };

  const handleConfirmDelete = () => {
    if (!toDelete) return;
    const target = toDelete;
    setListError("");
    deleteGuardian.mutate(target.id, {
      onSuccess: () => {
        setToDelete(null);
        onChanged?.();
      },
      onError: (err) => {
        setToDelete(null);
        // 409: algún consentimiento referencia al representante.
        setListError(
          getApiErrorMessage(err, "No se pudo quitar el representante"),
        );
      },
    });
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <p className="font-medium text-slate-700 text-sm">
          Representantes legales
        </p>
        {editing === null && canAdd && (
          <button
            type="button"
            onClick={() => {
              setFormError("");
              setEditing("new");
            }}
            className="btn-secondary text-xs py-1 flex items-center gap-1"
          >
            <Plus size={12} /> Agregar representante
          </button>
        )}
      </div>

      {guardiansQuery.isError && (
        <p className="text-red-500 text-xs mb-3 flex items-center gap-1">
          <AlertCircle size={11} /> No se pudieron cargar los representantes.
        </p>
      )}
      {listError && <ErrorBanner icon message={listError} className="mb-3" />}

      {guardiansQuery.isLoading ? (
        <p className="text-xs text-slate-500">Cargando...</p>
      ) : guardians.length === 0 ? (
        guardiansQuery.isError ? null : (
          <p className="text-xs text-slate-500 mb-3">
            Sin representantes registrados.
          </p>
        )
      ) : (
        <ul className="space-y-2 mb-3">
          {guardians.map((g) => (
            <li
              key={g.id}
              className="bg-slate-50 rounded-lg px-3 py-2 flex items-start justify-between"
            >
              <div className="min-w-0 text-xs text-slate-600 space-y-0.5">
                <p className="font-medium text-slate-700">{g.fullName}</p>
                <p>
                  {GUARDIAN_RELATIONSHIP_LABELS[g.relationship]} ·{" "}
                  {formatRut(g.rut)} · {CUSTODY_LABELS[g.custody]}
                </p>
                <p>
                  {[g.email, g.phone].filter(Boolean).join(" · ") ||
                    "Sin datos de contacto"}
                </p>
                <p className="flex flex-wrap gap-1 pt-1">
                  {g.canConsent && <Tag>Consiente</Tag>}
                  {g.isPayer && <Tag>Pagador</Tag>}
                  {g.receivesCommunications && <Tag>Recibe avisos</Tag>}
                  {g.canAccessReports && <Tag>Accede a informes</Tag>}
                  {g.hasConflict && (
                    <Tag warn>Conflicto entre representantes</Tag>
                  )}
                </p>
              </div>
              <div className="flex items-center shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setFormError("");
                    setEditing(g.id);
                  }}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500"
                  aria-label={`Editar a ${g.fullName}`}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setToDelete(g)}
                  className="p-1.5 hover:bg-red-50 rounded-lg text-red-500"
                  aria-label={`Quitar a ${g.fullName}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!canAdd && editing === null && (
        <p className="text-xs text-slate-500">
          Se alcanzó el máximo de {MAX_GUARDIANS} representantes por paciente.
        </p>
      )}

      {editing !== null && (editing === "new" || editingGuardian) && (
        <GuardianForm
          // Remonta el formulario al cambiar de representante para recargar sus valores.
          key={editing}
          initial={editingGuardian}
          isPending={createGuardian.isPending || updateGuardian.isPending}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={closeForm}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title="Quitar representante"
          message={`¿Quitar a "${toDelete.fullName}" como representante legal? Si algún consentimiento lo referencia, no se podrá quitar.`}
          confirmLabel="Quitar"
          onConfirm={handleConfirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}

function Tag({
  children,
  warn,
}: {
  children: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-full ${
        warn ? "bg-amber-50 text-amber-700" : "bg-slate-200 text-slate-600"
      }`}
    >
      {children}
    </span>
  );
}
