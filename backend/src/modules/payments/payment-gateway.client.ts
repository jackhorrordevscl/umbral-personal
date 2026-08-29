// design.md "Decision: One PaymentGatewayClient port; the merchant-
// attribution parameter is an implementation detail": PaymentsService nunca
// ve un nombre de campo de Flow -- confina ese desconocido a un solo archivo
// (flow-gateway.client.ts, PR 2). El puerto es abstracto para que un
// segundo gateway (MercadoPago, proposal.md) implemente la misma interfaz
// sin tocar PaymentsService.
export type PaymentGatewayFailureKind =
  | 'transient'
  | 'rejected'
  | 'credentials';

// Mismo patrón que GoogleCalendarError (google-calendar.client.ts):
// 'transient' -- red/5xx/rate-limit, reintentable por el reconciler;
// 'rejected' -- el gateway rechazó la operación (merchant inválido, orden
// rechazada), no reintentable sin intervención; 'credentials' -- la cuenta
// no está conectada o la credencial no es válida.
export class PaymentGatewayError extends Error {
  constructor(
    public readonly kind: PaymentGatewayFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}

export type GatewayOrderStatus = 'PENDING' | 'PAID' | 'REJECTED';

export interface MerchantInput {
  therapistId: string;
  name: string;
  email: string;
  rutOrTaxId: string;
}

// merchantId identifica al merchant asociado (Comercios Asociados split
// mode) -- cómo se serializa en el wire de Flow es problema del adapter
// (design.md "OrderInput carries merchantId").
export interface OrderInput {
  merchantId: string;
  amount: number;
  currency: string;
  subject: string;
  externalId: string;
  returnUrl: string;
  confirmUrl: string;
}

export abstract class PaymentGatewayClient {
  abstract createMerchant(
    input: MerchantInput,
  ): Promise<{ merchantId: string }>;
  abstract createOrder(
    input: OrderInput,
  ): Promise<{ token: string; paymentUrl: string }>;
  abstract getOrderStatus(
    token: string,
  ): Promise<{ status: GatewayOrderStatus; gatewayPaymentId?: string }>;
  abstract verifyCallbackSignature(params: Record<string, string>): boolean;
}

// design.md "Migration / Rollout": sin credenciales de Flow el módulo se
// registra y no-opea con un logger.warn, exactamente como MailService sin
// RESEND_API_KEY -- este es el binding por default de PaymentGatewayClient
// en PR 1 (payments.module.ts), reemplazado por FlowPaymentGatewayClient en
// PR 2 (task 4.5). Cualquier llamada rechaza con kind 'credentials': el
// gateway real todavía no existe, así que ensureCharge() debe degradar sin
// romper la escritura clínica que lo dispara (spec.md, mismo criterio que
// "Non-Blocking Sync Failures" de calendar-integration).
export class UnconfiguredPaymentGatewayClient extends PaymentGatewayClient {
  private fail(): never {
    throw new PaymentGatewayError(
      'credentials',
      'PaymentGatewayClient sin implementación configurada (FlowPaymentGatewayClient llega en PR 2).',
    );
  }

  createMerchant(): Promise<{ merchantId: string }> {
    this.fail();
  }

  createOrder(): Promise<{ token: string; paymentUrl: string }> {
    this.fail();
  }

  getOrderStatus(): Promise<{
    status: GatewayOrderStatus;
    gatewayPaymentId?: string;
  }> {
    this.fail();
  }

  verifyCallbackSignature(): boolean {
    this.fail();
  }
}
