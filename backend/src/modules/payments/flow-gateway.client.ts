import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PaymentProvider } from '@prisma/client';
import {
  CredentialValidation,
  GatewayCredentials,
  GatewayOrderStatus,
  OrderInput,
  PaymentGatewayClient,
  PaymentGatewayError,
} from './payment-gateway.client';

// design.md "Port contract" + Decision 1/2: concrete adapter of
// PaymentGatewayClient against Flow's public REST API, now stateless -- every
// call is signed with the GatewayCredentials the caller resolved
// (PaymentAccountService, the sole decryption owner), never with an ambient
// FLOW_API_KEY/FLOW_SECRET_KEY. No sandbox credentials were available in the
// session that first wrote this adapter -- this file was built from Flow's
// public documentation (https://developers.flow.cl/en/docs/payment)
// researched in that session, NOT against a real sandbox. Before production
// this needs to be re-confirmed against real credentials:
//   - CONFIRMED by the public docs: the /payment/create, /payment/getStatus
//     endpoints; the HMAC-SHA256 signature scheme over alphabetically sorted
//     parameters (same criterion used by Flow's official SDKs); that the
//     checkout URL is built as `url + "?token=" + token`; that the
//     confirmation webhook (urlConfirmation) does NOT carry a trustworthy
//     status in the POST -- only a `token` to re-query (validates the design
//     decision "The confirmation callback is a signal, never a source of
//     truth").
//   - CORRECTED against a real Flow sandbox: /payment/create also requires
//     `email` (400 "Missing service params: email" without it) -- not
//     mentioned as required in the public docs referenced above.
//   - UNVERIFIED (best-effort, explicitly flagged below): the exact numeric
//     mapping of /payment/getStatus (assumes 1=pending, 2=paid, 3=rejected,
//     4=voided, the most commonly documented scheme for Flow, but not
//     confirmed against a real response); the exact field name Flow uses for
//     the payment id in the getStatus response (assumes `flowOrder`);
//     design.md Decision 1's taxonomy for a sentinel-token /payment/getStatus
//     probe (401/403 invalid credentials, 400/404 valid -- token simply not
//     found), flagged as an Open Question in design.md pending confirmation
//     against a real Flow sandbox.
const DEFAULT_API_BASE_URL = 'https://sandbox.flow.cl/api';

// design.md Decision 1: a deliberately non-existent token used only to probe
// whether the passed credentials sign correctly. Flow authenticates the
// signature *before* resolving the token, so 400/404 here means "credentials
// valid, token (as expected) not found" -- never a real order.
const VALIDATION_PROBE_TOKEN = 'umbral-credential-validation-probe';

interface FlowPaymentCreateResponse {
  flowOrder: number;
  url: string;
  token: string;
}

interface FlowPaymentStatusResponse {
  status: number;
  flowOrder?: number;
}

@Injectable()
export class FlowPaymentGatewayClient extends PaymentGatewayClient {
  private readonly logger = new Logger(FlowPaymentGatewayClient.name);

  readonly provider = PaymentProvider.FLOW;

  constructor(private config: ConfigService) {
    super();
  }

  // design.md Decision 1: the sentinel-token getStatus probe. Reuses
  // getOrderStatus's own request()/error-taxonomy mapping instead of
  // duplicating it -- a 'rejected' (400/404, token not found) means the
  // signature authenticated fine, which IS the valid-credentials signal;
  // 'credentials' (401/403) and 'transient' (5xx/network) propagate
  // unchanged so the caller (PaymentAccountService, Phase 2) persists
  // nothing on either.
  async validateCredentials(
    credentials: GatewayCredentials,
  ): Promise<CredentialValidation> {
    try {
      await this.getOrderStatus(credentials, VALIDATION_PROBE_TOKEN);
    } catch (err) {
      if (err instanceof PaymentGatewayError && err.kind === 'rejected') {
        return { keyFingerprint: this.fingerprint(credentials) };
      }
      throw err;
    }
    // Flow resolving the sentinel token at all is not expected in practice
    // (it's deliberately non-existent) -- if it ever happens the signature
    // clearly authenticated, so the credentials are still valid.
    return { keyFingerprint: this.fingerprint(credentials) };
  }

  async createOrder(
    credentials: GatewayCredentials,
    input: OrderInput,
  ): Promise<{ token: string; paymentUrl: string }> {
    const params: Record<string, string> = {
      apiKey: credentials.apiKey,
      commerceOrder: input.externalId,
      subject: input.subject,
      currency: input.currency,
      amount: String(input.amount),
      email: input.payerEmail,
      urlConfirmation: input.confirmUrl,
      urlReturn: input.returnUrl,
    };
    params.s = this.sign(params, credentials.secretKey);

    const response = await this.request<FlowPaymentCreateResponse>(
      'POST',
      '/payment/create',
      params,
    );
    return {
      token: response.token,
      paymentUrl: `${response.url}?token=${response.token}`,
    };
  }

  async getOrderStatus(
    credentials: GatewayCredentials,
    token: string,
  ): Promise<{ status: GatewayOrderStatus; gatewayPaymentId?: string }> {
    const params: Record<string, string> = {
      apiKey: credentials.apiKey,
      token,
    };
    params.s = this.sign(params, credentials.secretKey);

    const response = await this.request<FlowPaymentStatusResponse>(
      'GET',
      '/payment/getStatus',
      params,
    );

    return {
      status: this.mapStatus(response.status),
      gatewayPaymentId:
        response.flowOrder !== undefined
          ? String(response.flowOrder)
          : undefined,
    };
  }

  // design.md "The confirmation callback is a signal, never a source of
  // truth": this function NEVER decides the payment's status -- it only
  // validates that the POST really came from Flow, signed with the owning
  // therapist's secretKey (resolved by the caller before this is invoked),
  // before the controller re-queries getOrderStatus. Returns false (never
  // throws) on any invalid condition -- the caller decides whether to reject
  // with 400.
  verifyCallbackSignature(
    credentials: GatewayCredentials,
    params: Record<string, string>,
  ): boolean {
    const { s, ...rest } = params;
    if (!s) return false;

    const expected = this.sign(rest, credentials.secretKey);

    // Buffer.from(str, 'hex') truncates at the first non-hex character
    // instead of throwing -- if `s` comes with non-hex garbage or a
    // different length than expected, the length check rejects before
    // reaching timingSafeEqual (which throws RangeError on buffers of
    // different lengths).
    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(s, 'hex');
    if (expectedBuf.length !== receivedBuf.length || expectedBuf.length === 0) {
      return false;
    }

    return timingSafeEqual(expectedBuf, receivedBuf);
  }

  // Flow's standard signing convention (replicated from its official
  // SDKs, consistently documented across its whole public API): sort the
  // keys alphabetically, concatenate each key+value with no
  // separator, HMAC-SHA256 in hex over that string with the account's
  // secretKey.
  private sign(params: Record<string, string>, secretKey: string): string {
    const sortedKeys = Object.keys(params).sort();
    const toSign = sortedKeys.map((key) => `${key}${params[key]}`).join('');
    return createHmac('sha256', secretKey).update(toSign).digest('hex');
  }

  // Non-secret display fingerprint (design.md "Encrypted Credential Storage
  // With Non-Secret Display Metadata"): bound to both apiKey and secretKey so
  // reusing the same apiKey with a rotated secretKey doesn't collide, but the
  // digest itself never lets the raw credential be recovered.
  private fingerprint(credentials: GatewayCredentials): string {
    return createHash('sha256')
      .update(`${credentials.apiKey}:${credentials.secretKey}`)
      .digest('hex')
      .slice(0, 12);
  }

  // 1=pending, 2=paid, 3=rejected, 4=voided -- UNVERIFIED against a
  // real sandbox (see the file header comment).
  // GatewayOrderStatus has no CANCELLED variant of its own (the port is
  // shared with any future gateway, design.md "Port contract"), so a 4 is
  // conservatively mapped to REJECTED -- neither code must ever transition to
  // PAID.
  private mapStatus(rawStatus: number): GatewayOrderStatus {
    switch (rawStatus) {
      case 1:
        return 'PENDING';
      case 2:
        return 'PAID';
      case 3:
      case 4:
        return 'REJECTED';
      default:
        this.logger.error(
          `Flow devolvió un status numérico no reconocido: ${rawStatus}`,
        );
        return 'REJECTED';
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const baseUrl =
      this.config.get<string>('FLOW_API_BASE_URL') ?? DEFAULT_API_BASE_URL;

    let response: Response;
    try {
      if (method === 'GET') {
        const query = new URLSearchParams(params).toString();
        response = await fetch(`${baseUrl}${path}?${query}`, { method });
      } else {
        response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(params).toString(),
        });
      }
    } catch (err) {
      throw new PaymentGatewayError(
        'transient',
        `Error de red hacia Flow: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    const body = await response.text();
    this.logger.error(
      `Flow devolvió ${response.status} (${method} ${path}): ${body}`,
    );

    if (response.status === 401 || response.status === 403) {
      throw new PaymentGatewayError(
        'credentials',
        `Flow devolvió ${response.status} (${method} ${path}) -- apiKey/firma inválida: ${body}`,
      );
    }
    if (response.status === 400 || response.status === 404) {
      throw new PaymentGatewayError(
        'rejected',
        `Flow devolvió ${response.status} (${method} ${path}): ${body}`,
      );
    }

    throw new PaymentGatewayError(
      'transient',
      `Flow devolvió ${response.status} (${method} ${path}): ${body}`,
    );
  }
}
