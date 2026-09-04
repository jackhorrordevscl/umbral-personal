// design.md "Decision: One PaymentGatewayClient port; the merchant-
// attribution parameter is an implementation detail": PaymentsService never
// sees a Flow field name -- that unknown is confined to a single file
// (flow-gateway.client.ts, PR 2). The port is abstract so a
// second gateway (MercadoPago, proposal.md) can implement the same
// interface without touching PaymentsService.
export type PaymentGatewayFailureKind =
  | 'transient'
  | 'rejected'
  | 'credentials';

// Same pattern as GoogleCalendarError (google-calendar.client.ts):
// 'transient' -- network/5xx/rate-limit, retryable by the reconciler;
// 'rejected' -- the gateway rejected the operation (invalid merchant, order
// rejected), not retryable without intervention; 'credentials' -- the
// account isn't connected or the credential is invalid.
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

// merchantId identifies the associated merchant (Comercios Asociados split
// mode) -- how it's serialized on Flow's wire is the adapter's problem
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

// design.md "Migration / Rollout": without Flow credentials the module
// registers and no-ops with a logger.warn, exactly like MailService without
// RESEND_API_KEY -- this is PaymentGatewayClient's default binding
// in PR 1 (payments.module.ts), replaced by FlowPaymentGatewayClient in
// PR 2 (task 4.5). Any call rejects with kind 'credentials': the
// real gateway doesn't exist yet, so ensureCharge() must degrade without
// breaking the clinical write that triggers it (spec.md, same criterion as
// calendar-integration's "Non-Blocking Sync Failures").
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
