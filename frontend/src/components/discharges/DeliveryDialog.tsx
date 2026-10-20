import { useId, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import Modal from "../ui/Modal";
import FormField from "../ui/FormField";
import ErrorBanner from "../ui/ErrorBanner";
import { useRecordDelivery } from "../../hooks/useDischarges";
import { useGuardians } from "../../hooks/useGuardians";
import { usePatientDocuments } from "../../hooks/usePatientDocuments";
import {
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_PURPOSE_MAX,
  DELIVERY_RECIPIENT_NAME_MAX,
  RECIPIENT_TYPE_LABELS,
  type DischargeDeliveryChannel,
  type DischargeRecipientType,
  type RecordDeliveryPayload,
} from "../../types/discharge";
import { getApiErrorMessage } from "../../utils/api-error";

interface DeliveryDialogProps {
  dischargeId: string;
  patientId: string;
  isMinor: boolean;
  onClose: () => void;
  onDone: () => void;
}

const CHANNELS = Object.keys(DELIVERY_CHANNEL_LABELS) as DischargeDeliveryChannel[];

// Registro de una entrega del informe de alta. A un NNA no se le entrega
// directamente (el servidor rechaza PATIENT): se ofrece su representante con
// acceso a informes. Un tercero requiere una autorización ya subida a la ficha.
export default function DeliveryDialog({
  dischargeId,
  patientId,
  isMinor,
  onClose,
  onDone,
}: DeliveryDialogProps) {
  const ids = {
    type: useId(),
    guardian: useId(),
    name: useId(),
    authorization: useId(),
    attested: useId(),
    purpose: useId(),
    channel: useId(),
  };
  const record = useRecordDelivery(dischargeId);
  const guardiansQuery = useGuardians(patientId, isMinor);
  const documentsQuery = usePatientDocuments(patientId);

  const recipientTypes: DischargeRecipientType[] = isMinor
    ? ["GUARDIAN", "THIRD_PARTY"]
    : ["PATIENT", "THIRD_PARTY"];
  const [recipientType, setRecipientType] = useState<DischargeRecipientType>(recipientTypes[0]);
  const [guardianId, setGuardianId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [authorizationDocumentId, setAuthorizationDocumentId] = useState("");
  const [authorizationAttested, setAuthorizationAttested] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [channel, setChannel] = useState<DischargeDeliveryChannel>("IN_PERSON");
  const [error, setError] = useState("");

  const guardians = (guardiansQuery.data ?? []).filter((g) => g.canAccessReports);
  const authorizations = (documentsQuery.data ?? []).filter(
    (d) => d.type === "DELIVERY_AUTHORIZATION" && !d.voidedAt,
  );

  const missingGuardians =
    recipientType === "GUARDIAN" && !guardiansQuery.isLoading && guardians.length === 0;
  const missingAuthorizations =
    recipientType === "THIRD_PARTY" && !documentsQuery.isLoading && authorizations.length === 0;

  const canSubmit =
    purpose.trim() !== "" &&
    !record.isPending &&
    (recipientType === "PATIENT" ||
      (recipientType === "GUARDIAN" && guardianId !== "") ||
      (recipientType === "THIRD_PARTY" &&
        recipientName.trim() !== "" &&
        authorizationDocumentId !== "" &&
        authorizationAttested));

  const buildPayload = (): RecordDeliveryPayload => {
    const base = { purpose: purpose.trim(), channel };
    if (recipientType === "GUARDIAN") return { recipientType, guardianId, ...base };
    if (recipientType === "THIRD_PARTY") {
      return {
        recipientType,
        recipientName: recipientName.trim(),
        authorizationDocumentId,
        authorizationAttested: true,
        ...base,
      };
    }
    return { recipientType, ...base };
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError("");
    record.mutate(buildPayload(), {
      onSuccess: onDone,
      onError: (err) => setError(getApiErrorMessage(err, "No se pudo registrar la entrega")),
    });
  };

  return (
    <Modal onClose={onClose} labelledBy="delivery-dialog-title" className="max-w-md p-6">
      <div className="flex items-start justify-between mb-4">
        <h3 id="delivery-dialog-title" className="font-display text-xl text-slate-900">
          Registrar entrega del informe
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 ml-4"
          aria-label="Cerrar"
        >
          <X size={20} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorBanner icon message={error} />}

        <FormField id={ids.type} label="Destinatario" required>
          <select
            id={ids.type}
            className="input-field"
            value={recipientType}
            onChange={(e) => setRecipientType(e.target.value as DischargeRecipientType)}
          >
            {recipientTypes.map((type) => (
              <option key={type} value={type}>
                {RECIPIENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </FormField>

        {recipientType === "GUARDIAN" && (
          <FormField id={ids.guardian} label="Representante" required>
            <select
              id={ids.guardian}
              className="input-field"
              value={guardianId}
              onChange={(e) => setGuardianId(e.target.value)}
            >
              <option value="">Seleccionar representante...</option>
              {guardians.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.fullName}
                </option>
              ))}
            </select>
            {missingGuardians && (
              <p className="text-xs text-amber-700 mt-1">
                Ningún representante tiene autorizado el acceso a informes. Actualiza su ficha
                para poder entregarle el informe.
              </p>
            )}
          </FormField>
        )}

        {recipientType === "THIRD_PARTY" && (
          <>
            <div
              role="note"
              className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1"
            >
              <p className="font-medium">Antes de entregar a un tercero</p>
              <p>
                La entrega a un tercero es responsabilidad tuya como terapeuta. Verifica que el
                documento que respalda la entrega sea auténtico y que cumpla lo que exige la ley:
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>
                  <span className="font-medium">Un tercero particular</span> (por ejemplo, un colegio
                  u otro profesional): necesita una autorización del titular mediante poder notarial
                  simple, es decir, un poder firmado ante notario.
                </li>
                <li>
                  <span className="font-medium">Un tribunal:</span> puede solicitar la información de
                  las causas que conoce, normalmente mediante un oficio.
                </li>
                <li>
                  <span className="font-medium">Un fiscal o un abogado:</span> requieren autorización
                  previa del juez competente.
                </li>
              </ul>
              <p>
                Umbral solo guarda el documento y deja constancia de la entrega. No comprueba su
                autenticidad ni su formalidad.
              </p>
            </div>
            <FormField id={ids.name} label="Nombre del tercero" required>
              <input
                id={ids.name}
                className="input-field"
                maxLength={DELIVERY_RECIPIENT_NAME_MAX}
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
              />
            </FormField>
            <FormField id={ids.authorization} label="Autorización" required>
              <select
                id={ids.authorization}
                className="input-field"
                value={authorizationDocumentId}
                onChange={(e) => {
                  setAuthorizationDocumentId(e.target.value);
                  setAuthorizationAttested(false);
                }}
              >
                <option value="">Seleccionar autorización...</option>
                {authorizations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fileName}
                  </option>
                ))}
              </select>
              {missingAuthorizations && (
                <p className="text-xs text-amber-700 mt-1">
                  Primero sube la autorización en Documentos legales (tipo «Autorización de entrega
                  de informe»): puede ser la autorización del paciente o de su representante, o el
                  oficio de un tribunal.
                </p>
              )}
            </FormField>
            <div className="flex items-start gap-2">
              <input
                id={ids.attested}
                type="checkbox"
                className="mt-0.5"
                checked={authorizationAttested}
                onChange={(e) => setAuthorizationAttested(e.target.checked)}
              />
              <label htmlFor={ids.attested} className="text-sm text-slate-700">
                Confirmo que revisé la autorización y que cumple lo que exige la ley para esta
                entrega.
              </label>
            </div>
          </>
        )}

        <FormField id={ids.purpose} label="Finalidad" required>
          <input
            id={ids.purpose}
            className="input-field"
            maxLength={DELIVERY_PURPOSE_MAX}
            aria-describedby={`${ids.purpose}-hint`}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
          <p id={`${ids.purpose}-hint`} className="text-xs text-slate-500 mt-1">
            Para qué se entrega. No incluir datos clínicos.
          </p>
        </FormField>

        <FormField id={ids.channel} label="Canal" required>
          <select
            id={ids.channel}
            className="input-field"
            value={channel}
            onChange={(e) => setChannel(e.target.value as DischargeDeliveryChannel)}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {DELIVERY_CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </FormField>

        <div className="flex gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={!canSubmit}>
            {record.isPending ? "Registrando..." : "Registrar"}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
