import { Logger } from '@nestjs/common';
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
// hex con el secretKey) -- así el test de validateCredentials no depende de
// invocar al propio cliente para generar el fixture.
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

  it('minimumAmount es 350 CLP (código 1901 de Flow)', () => {
    expect(client.minimumAmount).toBe(350);
  });

  describe('nivel de log de respuestas no exitosas', () => {
    function arrangeLogSpies() {
      return {
        warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(),
        error: jest.spyOn(Logger.prototype, 'error').mockImplementation(),
      };
    }

    it.each([400, 404])(
      'un %s (rechazo esperado) loguea warn, no error',
      async (status) => {
        const spies = arrangeLogSpies();
        mockFetchOnce({ ok: false, status });

        await expect(
          client.getOrderStatus(credentials, 'token'),
        ).rejects.toMatchObject({ kind: 'rejected' });

        expect(spies.warn).toHaveBeenCalledTimes(1);
        expect(spies.error).not.toHaveBeenCalled();
      },
    );

    it.each([401, 403, 500])('un %s loguea error, no warn', async (status) => {
      const spies = arrangeLogSpies();
      mockFetchOnce({ ok: false, status });

      await expect(
        client.getOrderStatus(credentials, 'token'),
      ).rejects.toBeInstanceOf(PaymentGatewayError);

      expect(spies.error).toHaveBeenCalledTimes(1);
      expect(spies.warn).not.toHaveBeenCalled();
    });
  });

  describe('timeout de las llamadas a Flow', () => {
    it('toda petición lleva un AbortSignal para no colgarse si Flow no responde', async () => {
      mockFetchOnce({ ok: true, status: 200 }, { status: 1 });
      mockFetchOnce({ ok: true, status: 200 }, { token: 't', url: 'u' });
      mockFetchOnce({ ok: true, status: 200 }, {});

      await client.getOrderStatus(credentials, 'tok');
      await client.createOrder(credentials, {
        amount: 50000,
        currency: 'CLP',
        subject: 'Sesión clínica',
        externalId: 'group-1',
        payerEmail: 'paciente@example.com',
        returnUrl: 'https://umbral.cl/payments',
        confirmUrl: 'https://umbral.cl/payments/confirm',
      });
      await client.voidOrder(credentials, 'tok');

      const calls = (globalThis.fetch as jest.Mock).mock.calls as [
        string,
        RequestInit,
      ][];
      expect(calls).toHaveLength(3);
      for (const [, init] of calls) {
        expect(init.signal).toBeInstanceOf(AbortSignal);
      }
    });

    it('un timeout al esperar la respuesta se clasifica como transient', async () => {
      (globalThis.fetch as jest.Mock).mockRejectedValueOnce(
        new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError',
        ),
      );

      await expect(
        client.getOrderStatus(credentials, 'tok'),
      ).rejects.toMatchObject({
        kind: 'transient',
      } as Partial<PaymentGatewayError>);
    });

    it('un timeout al leer el cuerpo de una respuesta exitosa se clasifica como transient', async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest
          .fn()
          .mockRejectedValue(
            new DOMException('The operation was aborted', 'TimeoutError'),
          ),
      });

      await expect(
        client.getOrderStatus(credentials, 'tok'),
      ).rejects.toMatchObject({
        kind: 'transient',
      } as Partial<PaymentGatewayError>);
    });
  });

  describe('clasificación de fallos con resultado incierto', () => {
    const orderInput = {
      amount: 50000,
      currency: 'CLP',
      subject: 'Sesión clínica',
      externalId: 'group-1',
      payerEmail: 'paciente@example.com',
      returnUrl: 'https://umbral.cl/payments',
      confirmUrl: 'https://umbral.cl/payments/confirm',
    };

    it('un 200 con cuerpo que no es JSON en un POST es indeterminate: la orden pudo crearse sin que llegue su token', async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest
          .fn()
          .mockRejectedValue(new SyntaxError('Unexpected token < in JSON')),
      });

      await expect(
        client.createOrder(credentials, orderInput),
      ).rejects.toMatchObject({
        kind: 'indeterminate',
      } as Partial<PaymentGatewayError>);
    });

    it('un 200 con cuerpo que no es JSON en un GET es invalid_response, no transient', async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest
          .fn()
          .mockRejectedValue(new SyntaxError('Unexpected token < in JSON')),
      });

      await expect(
        client.getOrderStatus(credentials, 'tok'),
      ).rejects.toMatchObject({
        kind: 'invalid_response',
      } as Partial<PaymentGatewayError>);
    });

    it('un timeout en un POST (createOrder) es indeterminate: Flow pudo haber creado la orden', async () => {
      (globalThis.fetch as jest.Mock)
        .mockRejectedValueOnce(
          new DOMException('The operation timed out', 'TimeoutError'),
        )
        .mockRejectedValueOnce(
          new DOMException('The operation timed out', 'TimeoutError'),
        );

      await expect(
        client.createOrder(credentials, orderInput),
      ).rejects.toMatchObject({
        kind: 'indeterminate',
      } as Partial<PaymentGatewayError>);
      await expect(client.createOrder(credentials, orderInput)).rejects.toThrow(
        'pudo haberse procesado',
      );
    });

    it('un timeout en un POST (voidOrder) es indeterminate', async () => {
      (globalThis.fetch as jest.Mock).mockRejectedValueOnce(
        new DOMException('The operation was aborted', 'AbortError'),
      );

      await expect(client.voidOrder(credentials, 'tok')).rejects.toMatchObject({
        kind: 'indeterminate',
      } as Partial<PaymentGatewayError>);
    });

    // Issue #494: un corte de red tras enviar el POST (reset, socket cerrado)
    // deja el mismo resultado incierto que un timeout.
    it.each(['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE'])(
      'un %s en un POST (createOrder) es indeterminate: la conexión se cortó después de enviar',
      async (code) => {
        (globalThis.fetch as jest.Mock).mockRejectedValueOnce(
          new TypeError('fetch failed', { cause: { code } }),
        );

        await expect(
          client.createOrder(credentials, orderInput),
        ).rejects.toMatchObject({
          kind: 'indeterminate',
        } as Partial<PaymentGatewayError>);
      },
    );

    it.each(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'])(
      'un %s en un POST sigue siendo transient: la solicitud nunca llegó a Flow',
      async (code) => {
        (globalThis.fetch as jest.Mock).mockRejectedValueOnce(
          new TypeError('fetch failed', { cause: { code } }),
        );

        await expect(
          client.createOrder(credentials, orderInput),
        ).rejects.toMatchObject({
          kind: 'transient',
        } as Partial<PaymentGatewayError>);
      },
    );

    it('un ECONNRESET en un GET sigue siendo transient: es de solo lectura', async () => {
      (globalThis.fetch as jest.Mock).mockRejectedValueOnce(
        new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }),
      );

      await expect(
        client.getOrderStatus(credentials, 'tok'),
      ).rejects.toMatchObject({
        kind: 'transient',
      } as Partial<PaymentGatewayError>);
    });

    it('un timeout al leer el cuerpo de un POST exitoso es indeterminate: la orden pudo crearse sin que llegue su token', async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest
          .fn()
          .mockRejectedValue(
            new DOMException('The operation timed out', 'TimeoutError'),
          ),
      });

      await expect(
        client.createOrder(credentials, orderInput),
      ).rejects.toMatchObject({
        kind: 'indeterminate',
      } as Partial<PaymentGatewayError>);
    });

    it('un error de red que no es timeout en un POST sigue siendo transient', async () => {
      (globalThis.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('ECONNREFUSED'),
      );

      await expect(
        client.createOrder(credentials, orderInput),
      ).rejects.toMatchObject({
        kind: 'transient',
      } as Partial<PaymentGatewayError>);
    });

    it.each([
      [401, 'credentials'],
      [403, 'credentials'],
      [400, 'rejected'],
      [404, 'rejected'],
    ])(
      'si el cuerpo de un %i en un POST expira, se clasifica por el status (%s), no como indeterminate',
      async (status, kind) => {
        (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
          ok: false,
          status,
          text: jest
            .fn()
            .mockRejectedValue(
              new DOMException('The operation timed out', 'TimeoutError'),
            ),
        });

        await expect(
          client.createOrder(credentials, orderInput),
        ).rejects.toMatchObject({ kind } as Partial<PaymentGatewayError>);
      },
    );

    it('si el cuerpo de un 500 en un POST expira, el resultado sigue siendo indeterminate', async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: jest
          .fn()
          .mockRejectedValue(
            new DOMException('The operation timed out', 'TimeoutError'),
          ),
      });

      await expect(
        client.createOrder(credentials, orderInput),
      ).rejects.toMatchObject({
        kind: 'indeterminate',
      } as Partial<PaymentGatewayError>);
    });

    it('el timeout de cada petición es de 10 segundos', async () => {
      const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
      mockFetchOnce({ ok: true, status: 200 }, { status: 1 });

      await client.getOrderStatus(credentials, 'tok');

      expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    });

    it('un timeout al leer el cuerpo de un error de Flow en un GET es transient', async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: jest
          .fn()
          .mockRejectedValue(
            new DOMException('The operation timed out', 'TimeoutError'),
          ),
      });

      await expect(
        client.getOrderStatus(credentials, 'tok'),
      ).rejects.toMatchObject({
        kind: 'transient',
      } as Partial<PaymentGatewayError>);
    });
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
        payerEmail: 'paciente@example.com',
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
      expect(sentBody.get('email')).toBe('paciente@example.com');
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
          payerEmail: 'paciente@example.com',
          returnUrl: 'https://umbral.cl/payments',
          confirmUrl: 'https://umbral.cl/payments/confirm',
        }),
      ).rejects.toMatchObject({
        kind: 'rejected',
      } as Partial<PaymentGatewayError>);
    });

    it('no filtra el email del paciente en el log ni en el mensaje del error de Flow', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      mockFetchOnce(
        { ok: false, status: 400 },
        { message: 'Invalid email paciente@example.com' },
      );

      const promise = client.createOrder(credentials, {
        amount: 50000,
        currency: 'CLP',
        subject: 'Sesión clínica',
        externalId: 'group-1',
        payerEmail: 'paciente@example.com',
        returnUrl: 'https://umbral.cl/payments',
        confirmUrl: 'https://umbral.cl/payments/confirm',
      });

      await expect(promise).rejects.toThrow('p***@example.com');
      await expect(promise).rejects.not.toThrow('paciente@example.com');
      const logged = String(warnSpy.mock.calls[0][0]);
      expect(logged).toContain('p***@example.com');
      expect(logged).not.toContain('paciente@example.com');
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
          payerEmail: 'paciente@example.com',
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

    // issue #284: el monto que reporta Flow (número o string numérico) se
    // expone para que markPaid lo compare; uno no parseable se ignora.
    it.each([
      [45000, 45000],
      ['45000', 45000],
      ['no-numerico', undefined],
    ])('expone amount=%p como %p', async (raw, expected) => {
      mockFetchOnce(
        { ok: true, status: 200 },
        { status: 2, flowOrder: 1, amount: raw },
      );

      const result = await client.getOrderStatus(credentials, 'flow-token-abc');

      expect(result.amount).toBe(expected);
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
      mockFetchOnce({ ok: false, status: 404 }, { code: 1700 });

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

    // Issue #494: solo el código 1700 ("token no encontrado", el que devolvió
    // Flow de producción en una verificación exitosa) confirma que la firma
    // autenticó. Un 400/404 sin ese código no prueba nada sobre las claves.
    it('400 con código 1700 (token sentinela no encontrado) se interpreta como credenciales VÁLIDAS -- design.md Decision 1', async () => {
      mockFetchOnce(
        { ok: false, status: 400 },
        { code: 1700, message: 'Token not found' },
      );

      const result = await client.validateCredentials(credentials);

      expect(result.keyFingerprint).toEqual(expect.any(String));
      expect(result.keyFingerprint.length).toBeGreaterThan(0);
    });

    it('404 con código 1700 (token sentinela no encontrado) se interpreta como credenciales VÁLIDAS -- design.md Decision 1', async () => {
      mockFetchOnce(
        { ok: false, status: 404 },
        { code: 1700, message: 'Token not found' },
      );

      const result = await client.validateCredentials(credentials);

      expect(result.keyFingerprint).toEqual(expect.any(String));
    });

    // No hay documentación oficial a mano que fije el tipo del campo: el 1700
    // como cadena numérica también es "token no encontrado".
    it('400 con el código 1700 como cadena numérica también confirma las credenciales', async () => {
      mockFetchOnce(
        { ok: false, status: 400 },
        { code: '1700', message: 'Token not found' },
      );

      const result = await client.validateCredentials(credentials);

      expect(result.keyFingerprint).toEqual(expect.any(String));
    });

    it.each([
      ['400 con otro código de error', 400, { code: 1234, message: 'x' }],
      ['400 con un código no numérico', 400, { code: 'abc', message: 'x' }],
      ['400 con cuerpo vacío', 400, {}],
      ['404 con otro código de error', 404, { code: 1234, message: 'x' }],
      ['404 con cuerpo vacío', 404, {}],
    ])(
      '%s NO confirma las credenciales: se rechaza como credentials',
      async (_label, status, body) => {
        mockFetchOnce({ ok: false, status }, body);

        await expect(
          client.validateCredentials(credentials),
        ).rejects.toMatchObject({
          kind: 'credentials',
        } as Partial<PaymentGatewayError>);
      },
    );

    // Una FLOW_API_BASE_URL equivocada o un proxy que responde 404 con HTML no
    // es Flow: antes quedaba como "credenciales válidas".
    it('404 con un cuerpo que no es JSON (URL equivocada o proxy) NO confirma las credenciales', async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue('<html>Not Found</html>'),
      });

      await expect(
        client.validateCredentials(credentials),
      ).rejects.toMatchObject({
        kind: 'credentials',
      } as Partial<PaymentGatewayError>);
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
      mockFetchOnce({ ok: false, status: 400 }, { code: 1700 });
      const first = await client.validateCredentials(credentials);

      mockFetchOnce({ ok: false, status: 400 }, { code: 1700 });
      const second = await client.validateCredentials(
        new GatewayCredentials('other-api-key', 'other-secret-key'),
      );

      expect(first.keyFingerprint).not.toEqual(second.keyFingerprint);
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
