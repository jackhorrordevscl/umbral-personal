import { useState } from "react";
import { Send } from "lucide-react";
import ErrorBanner from "../ui/ErrorBanner";
import DeliveryDialog from "./DeliveryDialog";
import { useDeliveries } from "../../hooks/useDischarges";
import {
  DELIVERY_CHANNEL_LABELS,
  RECIPIENT_TYPE_LABELS,
} from "../../types/discharge";
import { formatChileShortDateTime } from "../../utils/datetime";

interface DeliverySectionProps {
  dischargeId: string;
  patientId: string;
  isMinor: boolean;
}

// Entregas de un informe de alta emitido (T4c): a quién se entregó, por qué
// canal y para qué. Solo se agregan; no se editan ni se borran.
export default function DeliverySection({ dischargeId, patientId, isMinor }: DeliverySectionProps) {
  const deliveriesQuery = useDeliveries(dischargeId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const deliveries = deliveriesQuery.data ?? [];

  return (
    <div className="mt-2 pt-2 border-t border-slate-200">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-slate-600">Entregas</p>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="btn-secondary text-xs py-1 flex items-center gap-1"
        >
          <Send size={12} /> Registrar entrega
        </button>
      </div>

      {deliveriesQuery.isError && (
        <ErrorBanner
          icon
          message="No se pudieron cargar las entregas."
          onRetry={() => void deliveriesQuery.refetch()}
        />
      )}
      {deliveriesQuery.isLoading && <p className="text-xs text-slate-500">Cargando...</p>}
      {!deliveriesQuery.isLoading && !deliveriesQuery.isError && deliveries.length === 0 && (
        <p className="text-xs text-slate-500">Sin entregas registradas.</p>
      )}
      {deliveries.length > 0 && (
        <ul className="space-y-1">
          {deliveries.map((d) => (
            <li key={d.id} className="text-xs text-slate-600">
              <p className="font-medium text-slate-700">
                {RECIPIENT_TYPE_LABELS[d.recipientType]} · {d.recipientName}
              </p>
              <p>
                {DELIVERY_CHANNEL_LABELS[d.channel]} · {formatChileShortDateTime(d.deliveredAt)}
              </p>
              <p>{d.purpose}</p>
            </li>
          ))}
        </ul>
      )}

      {dialogOpen && (
        <DeliveryDialog
          dischargeId={dischargeId}
          patientId={patientId}
          isMinor={isMinor}
          onClose={() => setDialogOpen(false)}
          onDone={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}
