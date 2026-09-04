import { inspect } from 'util';
import { PaymentProvider } from '@prisma/client';

// design.md "Decision: One PaymentGatewayClient port; the merchant-
// attribution parameter is an implementation detail": PaymentsService never
// sees a Flow field name -- that unknown is confined to a single file
// (flow-gateway.client.ts). The port is abstract so a
// second gateway (MercadoPago, proposal.md) can implement the same
// interface without touching PaymentsService.
export type PaymentGatewayFailureKind =
  | 'transient'
  | 'rejected'
  | 'credentials';

// Same pattern as GoogleCalendarError (google-calendar.client.ts):
// 'transient' -- network/5xx/rate-limit, retryable by the reconciler;
// 'rejected' -- the gateway rejected the operation (order rejected, unknown
// token), not retryable without intervention; 'credentials' -- the
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

const REDACTED = '[redacted]' as const;

// design.md "Port contract" + "Secret-Handling Invariants": built ONLY by
// PaymentAccountService (the sole decryption owner, Decision 2). Overrides
// toJSON(), toString(), and util.inspect.custom so the raw apiKey/secretKey
// cannot leak through JSON.stringify(...) (API responses, error context),
// template-literal log interpolation (`${credentials}` calls toString()), or
// console.log/util.inspect/Logger calls (which use the inspect symbol) --
// all three hooks redact explicitly rather than relying on
// Object.prototype's incidental "[object Object]" default.
export class GatewayCredentials {
  constructor(
    public readonly apiKey: string,
    public readonly secretKey: string,
  ) {}

  toJSON(): typeof REDACTED {
    return REDACTED;
  }

  toString(): typeof REDACTED {
    return REDACTED;
  }

  [inspect.custom](): typeof REDACTED {
    return REDACTED;
  }
}

// design.md "Decision 2": what PaymentAccountService.resolveGatewayContext
// hands to PaymentsService -- provider selects the registry entry,
// credentials carries the already-redaction-safe value object above.
export interface GatewayContext {
  provider: PaymentProvider;
  credentials: GatewayCredentials;
}

// design.md "Decision 1": returned by validateCredentials with NO write --
// accountLabel is populated only when the gateway's response exposes a
// commerce name (Flow's sentinel probe never does today, Decision 1
// "Consequence"); keyFingerprint is always present so the confirmation step
// has something stable to show even without a returned label.
export interface CredentialValidation {
  accountLabel?: string;
  keyFingerprint: string;
}

// merchantId REMOVED (design.md "Port contract") -- every call now carries
// its own resolved GatewayCredentials instead of an ambient/attributed
// merchant id.
export interface OrderInput {
  amount: number;
  currency: string;
  subject: string;
  externalId: string;
  returnUrl: string;
  confirmUrl: string;
  // Discovered against a real Flow sandbox (not documented as required in
  // the public API docs): /payment/create rejects with 400 "Missing service
  // params: email" without this. Patient's email when available, falling
  // back to the therapist's own (PaymentsService.resolvePayerEmail) --
  // purely to satisfy Flow's required field, unrelated to link delivery
  // (deliverPaymentLink already handles a patient with no email on its
  // own).
  payerEmail: string;
}

// design.md "Port contract": stateless. Every method takes credentials in --
// no ambient config, no constructor-time secret, no per-therapist instance.
// A NestJS singleton binds one adapter per provider (payment-gateway.registry.ts),
// and the same adapter instance serves every therapist using that provider.
export abstract class PaymentGatewayClient {
  abstract readonly provider: PaymentProvider;

  abstract validateCredentials(
    credentials: GatewayCredentials,
  ): Promise<CredentialValidation>;

  abstract createOrder(
    credentials: GatewayCredentials,
    input: OrderInput,
  ): Promise<{ token: string; paymentUrl: string }>;

  abstract getOrderStatus(
    credentials: GatewayCredentials,
    token: string,
  ): Promise<{ status: GatewayOrderStatus; gatewayPaymentId?: string }>;

  abstract verifyCallbackSignature(
    credentials: GatewayCredentials,
    params: Record<string, string>,
  ): boolean;
}
