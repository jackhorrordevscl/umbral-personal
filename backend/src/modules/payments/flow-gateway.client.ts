import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  GatewayOrderStatus,
  MerchantInput,
  OrderInput,
  PaymentGatewayClient,
  PaymentGatewayError,
} from './payment-gateway.client';
import { PAYMENT_RETURN_PATH } from './payments.constants';

// sdd/online-payment-integration PR 2 (T4.1-4.4): concrete adapter of
// PaymentGatewayClient against Flow's public REST API (Comercios
// Asociados / Associated Merchants). No sandbox credentials were
// available in this session -- this file was built from Flow's public
// documentation (https://developers.flow.cl/en/docs/merchant,
// https://developers.flow.cl/en/docs/payment) researched in the session
// that wrote this PR, NOT against a real sandbox. Before production this
// needs to be re-confirmed against real credentials:
//   - CONFIRMED by the public docs: the /merchant/create,
//     /payment/create, /payment/getStatus endpoints; the HMAC-SHA256
//     signature scheme over alphabetically sorted parameters (same
//     criterion used by Flow's official SDKs); that /payment/create
//     accepts a `merchantId` parameter to attribute the order to an
//     associated merchant (resolves design.md's open question
//     "Exact Flow parameter attributing createOrder to an associated
//     merchant"); that the checkout URL is built as
//     `url + "?token=" + token`; that the confirmation webhook
//     (urlConfirmation) does NOT carry a trustworthy status in the POST --
//     only a `token` to re-query (validates the design decision "The
//     confirmation callback is a signal, never a source of truth").
//   - UNVERIFIED (best-effort, explicitly flagged below): the exact
//     numeric mapping of /payment/getStatus (assumes 1=pending,
//     2=paid, 3=rejected, 4=voided, the most commonly documented scheme
//     for Flow, but not confirmed against a real response); the exact
//     field name Flow uses for the payment id in the getStatus response
//     (assumes `flowOrder`).
const DEFAULT_API_BASE_URL = 'https://sandbox.flow.cl/api';
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

interface FlowMerchantCreateResponse {
  id: string;
  name: string;
  url: string;
  createdate: string;
  status: number;
  verifydate: string | null;
}

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

  constructor(private config: ConfigService) {
    super();
  }

  async createMerchant(input: MerchantInput): Promise<{ merchantId: string }> {
    const { apiKey, secretKey } = this.assertConfigured();
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? DEFAULT_FRONTEND_URL;

    const params: Record<string, string> = {
      apiKey,
      id: input.therapistId,
      name: input.name,
      url: `${frontendUrl}${PAYMENT_RETURN_PATH}`,
    };
    params.s = this.sign(params, secretKey);

    const response = await this.request<FlowMerchantCreateResponse>(
      'POST',
      '/merchant/create',
      params,
    );
    return { merchantId: response.id };
  }

  async createOrder(
    input: OrderInput,
  ): Promise<{ token: string; paymentUrl: string }> {
    const { apiKey, secretKey } = this.assertConfigured();

    const params: Record<string, string> = {
      apiKey,
      commerceOrder: input.externalId,
      subject: input.subject,
      currency: input.currency,
      amount: String(input.amount),
      urlConfirmation: input.confirmUrl,
      urlReturn: input.returnUrl,
      merchantId: input.merchantId,
    };
    params.s = this.sign(params, secretKey);

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
    token: string,
  ): Promise<{ status: GatewayOrderStatus; gatewayPaymentId?: string }> {
    const { apiKey, secretKey } = this.assertConfigured();

    const params: Record<string, string> = { apiKey, token };
    params.s = this.sign(params, secretKey);

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
  // validates that the POST really came from Flow, signed with our
  // secretKey, before the controller re-queries getOrderStatus
  // (payments.controller.ts, T5.6). Returns false (never throws) on any
  // invalid condition -- the caller decides whether to reject with 400.
  verifyCallbackSignature(params: Record<string, string>): boolean {
    const secretKey = this.config.get<string>('FLOW_SECRET_KEY');
    if (!secretKey) return false;

    const { s, ...rest } = params;
    if (!s) return false;

    const expected = this.sign(rest, secretKey);

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

  // 1=pending, 2=paid, 3=rejected, 4=voided -- UNVERIFIED against a
  // real sandbox (see the file header comment).
  // GatewayOrderStatus has no CANCELLED variant of its own (the port is
  // shared with any future gateway, design.md "One
  // PaymentGatewayClient port"), so a 4 is conservatively mapped to
  // REJECTED -- neither code must ever transition to PAID.
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

  private assertConfigured(): { apiKey: string; secretKey: string } {
    const apiKey = this.config.get<string>('FLOW_API_KEY');
    const secretKey = this.config.get<string>('FLOW_SECRET_KEY');
    if (!apiKey || !secretKey) {
      throw new PaymentGatewayError(
        'credentials',
        'FLOW_API_KEY/FLOW_SECRET_KEY no están configuradas.',
      );
    }
    return { apiKey, secretKey };
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
