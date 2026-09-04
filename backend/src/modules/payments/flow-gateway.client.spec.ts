import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { inspect } from 'util';
import { PaymentProvider } from '@prisma/client';
import { FlowPaymentGatewayClient } from './flow-gateway.client';
import {
  GatewayCredentials,
  PaymentGatewayError,
} from './payment-gateway.client';

// design.md Decision 1/2 + Port contract: same native-fetch mocking pattern
// as google-calendar.client.spec.ts. This adapter is now stateless -- no
// sandbox credentials were available in the session that wrote it either
// (see the header comment in flow-gateway.client.ts for what's confirmed
// against Flow's public docs vs. left unverified against a real sandbox).
function buildConfig(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    FLOW_API_BASE_URL: 'https://sandbox.flow.cl/api',
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
  let credentials: GatewayCredentials;

  beforeEach(() => {
    client = new FlowPaymentGatewayClient(buildConfig());
    credentials = new GatewayCredentials('test-api-key', 'test-secret-key');
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('provider es FLOW', () => {
    expect(client.provider).toBe(PaymentProvider.FLOW);
  });

  describe('createOrder', () => {
    it('firma la petición con las credenciales recibidas y construye la paymentUrl a partir de url + token', async () => {
      mockFetchOnce(
        { ok: true, status: 200 },
        {
          flowOrder: 123456,
          url: 'https://sandbox.flow.cl/app/web/pay.php',
          token: 'flow-token-abc',
        },
      );

      const result = await client.createOrder(credentials, {
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

      const [, requestInit] = (globalThis.fetch as jest.Mock).mock.calls[0] as [
        string,
        RequestInit,
      ];
      const sentBody = new URLSearchParams(requestInit.body as string);
      expect(sentBody.get('apiKey')).toBe('test-api-key');
      expect(sentBody.has('merchantId')).toBe(false);
    });

    it('clasifica un 400 (orden rechazada) como rejected', async () => {
      mockFetchOnce({ ok: false, status: 400 });

      await expect(
        client.createOrder(credentials, {
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
        client.createOrder(credentials, {
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

      const result = await client.getOrderStatus(credentials, 'flow-token-abc');

      expect(result).toEqual({ status: 'PAID', gatewayPaymentId: '123456' });
    });

    it('mapea status=1 (pendiente) a PENDING', async () => {
      mockFetchOnce({ ok: true, status: 200 }, { status: 1 });

      const result = await client.getOrderStatus(credentials, 'flow-token-abc');

      expect(result.status).toBe('PENDING');
    });

    it('mapea status=3 (rechazado) a REJECTED', async () => {
      mockFetchOnce({ ok: true, status: 200 }, { status: 3 });

      const result = await client.getOrderStatus(credentials, 'flow-token-abc');

      expect(result.status).toBe('REJECTED');
    });

    it('clasifica un 404 (token desconocido) como rejected', async () => {
      mockFetchOnce({ ok: false, status: 404 });

      await expect(
        client.getOrderStatus(credentials, 'token-inexistente'),
      ).rejects.toMatchObject({
        kind: 'rejected',
      } as Partial<PaymentGatewayError>);
    });
  });

  // design.md Decision 1 + spec.md "Guided Connection Wizard With
  // Pre-Persistence Validation": the sentinel-token getStatus probe taxonomy.
  // Flow authenticates the signature *before* resolving the token, so the
  // adapter's existing 401/403 vs 400/404 vs 5xx classification (request())
  // is reused, not reimplemented -- this suite locks in the taxonomy meaning
  // validateCredentials attaches to each bucket.
  describe('validateCredentials (probe taxonomy)', () => {
    it('sondea con el token sentinela documentado, firmado con las credenciales recibidas', async () => {
      mockFetchOnce({ ok: false, status: 404 });

      await client.validateCredentials(credentials);

      const [requestUrl] = (globalThis.fetch as jest.Mock).mock.calls[0] as [
        string,
        RequestInit,
      ];
      const query = new URL(requestUrl).searchParams;
      expect(query.get('apiKey')).toBe('test-api-key');
      expect(query.get('token')).toBe('umbral-credential-validation-probe');
      expect(query.get('s')).toBe(
        referenceSign(
          { apiKey: 'test-api-key', token: query.get('token')! },
          'test-secret-key',
        ),
      );
    });

    it('401 (firma inválida) se propaga como credentials inválidas, sin quedar como válidas', async () => {
      mockFetchOnce({ ok: false, status: 401 });

      await expect(
        client.validateCredentials(credentials),
      ).rejects.toMatchObject({
        kind: 'credentials',
      } as Partial<PaymentGatewayError>);
    });

    it('403 (rechazo de autorización) se propaga como credentials inválidas', async () => {
      mockFetchOnce({ ok: false, status: 403 });

      await expect(
        client.validateCredentials(credentials),
      ).rejects.toMatchObject({
        kind: 'credentials',
      } as Partial<PaymentGatewayError>);
    });

    it('400 (token sentinela no encontrado) se interpreta como credenciales VÁLIDAS -- design.md Decision 1', async () => {
      mockFetchOnce({ ok: false, status: 400 });

      const result = await client.validateCredentials(credentials);

      expect(result.keyFingerprint).toEqual(expect.any(String));
      expect(result.keyFingerprint.length).toBeGreaterThan(0);
    });

    it('404 (token sentinela no encontrado) se interpreta como credenciales VÁLIDAS -- design.md Decision 1', async () => {
      mockFetchOnce({ ok: false, status: 404 });

      const result = await client.validateCredentials(credentials);

      expect(result.keyFingerprint).toEqual(expect.any(String));
    });

    it('5xx se propaga como transient -- no debe interpretarse como válida ni inválida', async () => {
      mockFetchOnce({ ok: false, status: 500 });

      await expect(
        client.validateCredentials(credentials),
      ).rejects.toMatchObject({
        kind: 'transient',
      } as Partial<PaymentGatewayError>);
    });

    it('un error de red se propaga como transient', async () => {
      (globalThis.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('ECONNRESET'),
      );

      await expect(
        client.validateCredentials(credentials),
      ).rejects.toMatchObject({
        kind: 'transient',
      } as Partial<PaymentGatewayError>);
    });

    it('el fingerprint depende de las credenciales, no es un valor fijo', async () => {
      mockFetchOnce({ ok: false, status: 400 });
      const first = await client.validateCredentials(credentials);

      mockFetchOnce({ ok: false, status: 400 });
      const second = await client.validateCredentials(
        new GatewayCredentials('other-api-key', 'other-secret-key'),
      );

      expect(first.keyFingerprint).not.toEqual(second.keyFingerprint);
    });
  });

  describe('verifyCallbackSignature', () => {
    it('acepta una firma válida calculada con el secretKey de las credenciales recibidas', () => {
      const params = { token: 'flow-token-abc' };
      const s = referenceSign(params, 'test-secret-key');

      expect(
        client.verifyCallbackSignature(credentials, { ...params, s }),
      ).toBe(true);
    });

    it('rechaza un parámetro alterado tras firmar (tampered)', () => {
      const params = { token: 'flow-token-abc' };
      const s = referenceSign(params, 'test-secret-key');

      expect(
        client.verifyCallbackSignature(credentials, {
          token: 'flow-token-TAMPERED',
          s,
        }),
      ).toBe(false);
    });

    it('rechaza cuando falta el parámetro s', () => {
      expect(
        client.verifyCallbackSignature(credentials, {
          token: 'flow-token-abc',
        } as Record<string, string>),
      ).toBe(false);
    });

    it('rechaza una firma calculada con credenciales distintas (wrong key)', () => {
      const params = { token: 'flow-token-abc' };
      const s = referenceSign(params, 'una-clave-que-no-es-la-configurada');

      expect(
        client.verifyCallbackSignature(credentials, { ...params, s }),
      ).toBe(false);
    });

    it('rechaza cuando se agrega un parámetro extra no incluido en la firma original', () => {
      const params = { token: 'flow-token-abc' };
      const s = referenceSign(params, 'test-secret-key');

      expect(
        client.verifyCallbackSignature(credentials, {
          token: 'flow-token-abc',
          extra: 'campo-inyectado-por-un-atacante',
          s,
        }),
      ).toBe(false);
    });
  });
});

// design.md "Secret-Handling Invariants" + spec.md "Encrypted Credential
// Storage With Non-Secret Display Metadata": GatewayCredentials must redact
// through every path a secret could otherwise leak -- JSON.stringify
// (API responses, nested error context), template-literal log interpolation
// (toString()), and console.log/Logger/util.inspect (the inspect symbol).
describe('GatewayCredentials redaction', () => {
  const credentials = new GatewayCredentials(
    'super-secret-api-key',
    'super-secret-secret-key',
  );

  it('JSON.stringify redacta ambos secretos', () => {
    const serialized = JSON.stringify({ credentials });

    expect(serialized).not.toContain('super-secret-api-key');
    expect(serialized).not.toContain('super-secret-secret-key');
    expect(serialized).toBe(JSON.stringify({ credentials: '[redacted]' }));
  });

  it('la interpolación de template string (log interpolation) redacta ambos secretos', () => {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- deliberately exercising the toString() override under test
    const logLine = `Fallo al validar credenciales: ${credentials}`;

    expect(logLine).not.toContain('super-secret-api-key');
    expect(logLine).not.toContain('super-secret-secret-key');
    expect(logLine).toBe('Fallo al validar credenciales: [redacted]');
  });

  it('util.inspect (usado por console.log/Logger con objetos) redacta ambos secretos', () => {
    const inspected = inspect(credentials);

    expect(inspected).not.toContain('super-secret-api-key');
    expect(inspected).not.toContain('super-secret-secret-key');
    expect(inspected).toBe('[redacted]');
  });

  it('el redacted no impide seguir leyendo apiKey/secretKey por código legítimo (solo la serialización/log lo oculta)', () => {
    expect(credentials.apiKey).toBe('super-secret-api-key');
    expect(credentials.secretKey).toBe('super-secret-secret-key');
  });
});
