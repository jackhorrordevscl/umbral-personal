import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { FlowPaymentGatewayClient } from './flow-gateway.client';
import { PaymentGatewayError } from './payment-gateway.client';

// sdd/online-payment-integration PR 2 (T4.1-4.4): mismo patrón de mocking de
// fetch nativo que google-calendar.client.spec.ts (no hay credenciales de
// sandbox de Flow disponibles esta sesión -- ver flow-gateway.client.ts, el
// comentario del encabezado documenta qué viene de la documentación pública
// de Flow y qué queda sin verificar contra un sandbox real).
function buildConfig(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    FLOW_API_KEY: 'test-api-key',
    FLOW_SECRET_KEY: 'test-secret-key',
    FLOW_API_BASE_URL: 'https://sandbox.flow.cl/api',
    FRONTEND_URL: 'https://umbral.cl',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function mockFetchOnce(
  response: Partial<Response> & { ok: boolean; status: number },
  jsonBody: unknown = {},
) {
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
    json: jest.fn().mockResolvedValue(jsonBody),
    text: jest.fn().mockResolvedValue(JSON.stringify(jsonBody)),
    ...response,
  });
}

// Firma de referencia calculada de la misma forma que sign() debería
// calcularla (orden alfabético de claves, concatenación key+value, HMAC-SHA256
// hex con el secretKey) -- así los tests de verifyCallbackSignature no
// dependen de invocar al propio cliente para generar el fixture.
function referenceSign(
  params: Record<string, string>,
  secretKey: string,
): string {
  const sorted = Object.keys(params).sort();
  const toSign = sorted.map((k) => `${k}${params[k]}`).join('');
  return createHmac('sha256', secretKey).update(toSign).digest('hex');
}

describe('FlowPaymentGatewayClient', () => {
  let client: FlowPaymentGatewayClient;

  beforeEach(() => {
    client = new FlowPaymentGatewayClient(buildConfig());
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createMerchant', () => {
    it('firma la petición y mapea el id devuelto a merchantId', async () => {
      mockFetchOnce(
        { ok: true, status: 200 },
        {
          id: 'flow-merchant-1',
          name: 'Terapeuta A',
          url: 'https://umbral.cl/payments',
          createdate: '2026-01-01',
          status: 1,
          verifydate: null,
        },
      );

      const result = await client.createMerchant({
        therapistId: 'therapist-1',
        name: 'Terapeuta A',
        email: 'terapeuta.a@umbral.cl',
        rutOrTaxId: '11.111.111-1',
      });

      expect(result).toEqual({ merchantId: 'flow-merchant-1' });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/merchant/create'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('clasifica un 401 (apiKey/firma inválida) como credentials', async () => {
      mockFetchOnce({ ok: false, status: 401 });

      await expect(
        client.createMerchant({
          therapistId: 'therapist-1',
          name: 'Terapeuta A',
          email: 'terapeuta.a@umbral.cl',
          rutOrTaxId: '11.111.111-1',
        }),
      ).rejects.toMatchObject({
        kind: 'credentials',
      } as Partial<PaymentGatewayError>);
    });

    it('clasifica un 500 como transient', async () => {
      mockFetchOnce({ ok: false, status: 500 });

      await expect(
        client.createMerchant({
          therapistId: 'therapist-1',
          name: 'Terapeuta A',
          email: 'terapeuta.a@umbral.cl',
          rutOrTaxId: '11.111.111-1',
        }),
      ).rejects.toMatchObject({
        kind: 'transient',
      } as Partial<PaymentGatewayError>);
    });

    it('sin FLOW_API_KEY/FLOW_SECRET_KEY configuradas rechaza con credentials sin llegar a hacer fetch', async () => {
      const unconfigured = new FlowPaymentGatewayClient(
        buildConfig({ FLOW_API_KEY: undefined, FLOW_SECRET_KEY: undefined }),
      );

      await expect(
        unconfigured.createMerchant({
          therapistId: 'therapist-1',
          name: 'Terapeuta A',
          email: 'terapeuta.a@umbral.cl',
          rutOrTaxId: '11.111.111-1',
        }),
      ).rejects.toMatchObject({
        kind: 'credentials',
      } as Partial<PaymentGatewayError>);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe('createOrder', () => {
    it('construye la paymentUrl a partir de url + token, según la documentación pública de Flow', async () => {
      mockFetchOnce(
        { ok: true, status: 200 },
        {
          flowOrder: 123456,
          url: 'https://sandbox.flow.cl/app/web/pay.php',
          token: 'flow-token-abc',
        },
      );

      const result = await client.createOrder({
        merchantId: 'flow-merchant-1',
        amount: 50000,
        currency: 'CLP',
        subject: 'Sesión clínica',
        externalId: 'group-1',
        returnUrl: 'https://umbral.cl/payments',
        confirmUrl: 'https://umbral.cl/payments/confirm',
      });

      expect(result).toEqual({
        token: 'flow-token-abc',
        paymentUrl:
          'https://sandbox.flow.cl/app/web/pay.php?token=flow-token-abc',
      });
    });

    it('clasifica un 400 (orden rechazada) como rejected', async () => {
      mockFetchOnce({ ok: false, status: 400 });

      await expect(
        client.createOrder({
          merchantId: 'flow-merchant-1',
          amount: 50000,
          currency: 'CLP',
          subject: 'Sesión clínica',
          externalId: 'group-1',
          returnUrl: 'https://umbral.cl/payments',
          confirmUrl: 'https://umbral.cl/payments/confirm',
        }),
      ).rejects.toMatchObject({
        kind: 'rejected',
      } as Partial<PaymentGatewayError>);
    });

    it('clasifica un error de red como transient', async () => {
      (globalThis.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('ECONNRESET'),
      );

      await expect(
        client.createOrder({
          merchantId: 'flow-merchant-1',
          amount: 50000,
          currency: 'CLP',
          subject: 'Sesión clínica',
          externalId: 'group-1',
          returnUrl: 'https://umbral.cl/payments',
          confirmUrl: 'https://umbral.cl/payments/confirm',
        }),
      ).rejects.toMatchObject({
        kind: 'transient',
      } as Partial<PaymentGatewayError>);
    });
  });

  describe('getOrderStatus', () => {
    // NOTA: el mapeo numérico exacto de status no está confirmado contra un
    // sandbox real -- ver el comentario en flow-gateway.client.ts. Estos
    // tests fijan el comportamiento tal como quedó implementado, no como
    // verificación externa de la documentación de Flow.
    it('mapea status=2 (pagado, según la documentación pública) a PAID', async () => {
      mockFetchOnce(
        { ok: true, status: 200 },
        { status: 2, flowOrder: 123456 },
      );

      const result = await client.getOrderStatus('flow-token-abc');

      expect(result).toEqual({ status: 'PAID', gatewayPaymentId: '123456' });
    });

    it('mapea status=1 (pendiente) a PENDING', async () => {
      mockFetchOnce({ ok: true, status: 200 }, { status: 1 });

      const result = await client.getOrderStatus('flow-token-abc');

      expect(result.status).toBe('PENDING');
    });

    it('mapea status=3 (rechazado) a REJECTED', async () => {
      mockFetchOnce({ ok: true, status: 200 }, { status: 3 });

      const result = await client.getOrderStatus('flow-token-abc');

      expect(result.status).toBe('REJECTED');
    });

    it('clasifica un 404 (token desconocido) como rejected', async () => {
      mockFetchOnce({ ok: false, status: 404 });

      await expect(
        client.getOrderStatus('token-inexistente'),
      ).rejects.toMatchObject({
        kind: 'rejected',
      } as Partial<PaymentGatewayError>);
    });
  });

  describe('verifyCallbackSignature', () => {
    it('acepta una firma válida calculada con el mismo secretKey', () => {
      const params = { token: 'flow-token-abc' };
      const s = referenceSign(params, 'test-secret-key');

      expect(client.verifyCallbackSignature({ ...params, s })).toBe(true);
    });

    it('rechaza un parámetro alterado tras firmar (tampered)', () => {
      const params = { token: 'flow-token-abc' };
      const s = referenceSign(params, 'test-secret-key');

      expect(
        client.verifyCallbackSignature({ token: 'flow-token-TAMPERED', s }),
      ).toBe(false);
    });

    it('rechaza cuando falta el parámetro s', () => {
      expect(
        client.verifyCallbackSignature({ token: 'flow-token-abc' } as Record<
          string,
          string
        >),
      ).toBe(false);
    });

    it('rechaza una firma calculada con la clave incorrecta (wrong key)', () => {
      const params = { token: 'flow-token-abc' };
      const s = referenceSign(params, 'una-clave-que-no-es-la-configurada');

      expect(client.verifyCallbackSignature({ ...params, s })).toBe(false);
    });

    it('rechaza cuando se agrega un parámetro extra no incluido en la firma original', () => {
      const params = { token: 'flow-token-abc' };
      const s = referenceSign(params, 'test-secret-key');

      expect(
        client.verifyCallbackSignature({
          token: 'flow-token-abc',
          extra: 'campo-inyectado-por-un-atacante',
          s,
        }),
      ).toBe(false);
    });

    it('sin FLOW_SECRET_KEY configurada rechaza en vez de lanzar', () => {
      const unconfigured = new FlowPaymentGatewayClient(
        buildConfig({ FLOW_SECRET_KEY: undefined }),
      );
      const params = { token: 'flow-token-abc' };
      const s = referenceSign(params, 'test-secret-key');

      expect(unconfigured.verifyCallbackSignature({ ...params, s })).toBe(
        false,
      );
    });
  });
});
