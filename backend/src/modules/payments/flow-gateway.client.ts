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

// sdd/online-payment-integration PR 2 (T4.1-4.4): adapter concreto de
// PaymentGatewayClient contra la API REST pública de Flow (Comercios
// Asociados). Ninguna credencial de sandbox estuvo disponible en esta
// sesión -- este archivo se construyó a partir de la documentación pública
// de Flow (https://developers.flow.cl/en/docs/merchant,
// https://developers.flow.cl/en/docs/payment) investigada en la sesión que
// escribió este PR, NO contra un sandbox real. Antes de producción hay que
// re-confirmar contra credenciales reales:
//   - CONFIRMADO por la documentación pública: los endpoints /merchant/create,
//     /payment/create, /payment/getStatus; el esquema de firma HMAC-SHA256
//     sobre parámetros ordenados alfabéticamente (mismo criterio que usan los
//     SDKs oficiales de Flow); que /payment/create acepta un parámetro
//     `merchantId` para atribuir la orden a un comercio asociado (resuelve la
//     pregunta abierta de design.md "Exact Flow parameter attributing
//     createOrder to an associated merchant"); que la URL de checkout se arma
//     como `url + "?token=" + token`; que el webhook de confirmación
//     (urlConfirmation) NO trae un status confiable en el POST -- solo un
//     `token` a re-consultar (valida la decisión de diseño "The confirmation
//     callback is a signal, never a source of truth").
//   - SIN VERIFICAR (best-effort, marcado explícitamente abajo): el mapeo
//     numérico exacto de /payment/getStatus (se asume 1=pendiente,
//     2=pagado, 3=rechazada, 4=anulada, el esquema más común documentado
//     para Flow, pero no confirmado contra una respuesta real); el nombre
//     exacto del campo que Flow usa para el id de pago en la respuesta de
//     getStatus (se asume `flowOrder`).
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
  // truth": esta función NUNCA decide el estado del pago -- solo valida que
  // el POST realmente vino de Flow, firmado con nuestro secretKey, antes de
  // que el controller re-consulte getOrderStatus (payments.controller.ts,
  // T5.6). Devuelve false (nunca lanza) ante cualquier condición inválida --
  // el llamador es quien decide rechazar con 400.
  verifyCallbackSignature(params: Record<string, string>): boolean {
    const secretKey = this.config.get<string>('FLOW_SECRET_KEY');
    if (!secretKey) return false;

    const { s, ...rest } = params;
    if (!s) return false;

    const expected = this.sign(rest, secretKey);

    // Buffer.from(str, 'hex') trunca en el primer carácter no-hex en vez de
    // lanzar -- si `s` viene con basura no-hex o con largo distinto al
    // esperado, el chequeo de longitud rechaza antes de llegar a
    // timingSafeEqual (que lanza RangeError ante buffers de largo distinto).
    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(s, 'hex');
    if (expectedBuf.length !== receivedBuf.length || expectedBuf.length === 0) {
      return false;
    }

    return timingSafeEqual(expectedBuf, receivedBuf);
  }

  // Convención de firma estándar de Flow (replicada de sus SDKs oficiales,
  // documentada de forma consistente en toda su API pública): ordenar las
  // claves alfabéticamente, concatenar clave+valor de cada una sin
  // separador, HMAC-SHA256 en hex sobre esa cadena con el secretKey de la
  // cuenta.
  private sign(params: Record<string, string>, secretKey: string): string {
    const sortedKeys = Object.keys(params).sort();
    const toSign = sortedKeys.map((key) => `${key}${params[key]}`).join('');
    return createHmac('sha256', secretKey).update(toSign).digest('hex');
  }

  // 1=pendiente, 2=pagado, 3=rechazada, 4=anulada -- SIN VERIFICAR contra un
  // sandbox real (ver el comentario del encabezado del archivo).
  // GatewayOrderStatus no tiene una variante CANCELLED propia (el puerto es
  // compartido con cualquier gateway futuro, design.md "One
  // PaymentGatewayClient port"), así que un 4 se mapea conservadoramente a
  // REJECTED -- ninguno de los dos códigos debe transicionar nunca a PAID.
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
