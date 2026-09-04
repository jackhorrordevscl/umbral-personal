import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { createHmac } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentGatewayClient } from '../src/modules/payments/payment-gateway.client';
import { PaymentCredentialCryptoService } from '../src/modules/payments/payment-credential-crypto.service';

/**
 * sdd/online-payment-integration PR 2 (T7.7-7.10, design.md "Testing
 * Strategy" -- "E2E: tenancy (uniform 404) and forged public confirm never
 * mutates a Payment") + sdd/payments-multigateway-redesign task 3.7-3.9:
 * the security surfaces this file exercises as the module's real (Nest
 * TestingModule + Postgres) runtime harness:
 *   1. Tenancy: GET/DELETE /payments/account y PATCH /payments/:groupId
 *      quedan scoped exclusivamente al terapeuta autenticado
 *      (@CurrentUser(), nunca un :id que identifique la cuenta/cargo de
 *      otro) -- terapeuta B nunca ve ni puede mutar la cuenta o el cargo de
 *      terapeuta A, siempre con el mismo 404 uniforme.
 *   2. POST /payments/confirm es la ÚNICA ruta pública del módulo (sin
 *      JwtAuthGuard) -- un body forjado, sin firma, con token desconocido,
 *      o con campos extra jamás debe mutar un Payment, y el lookup
 *      read-only (findByToken) siempre precede a cualquier resolución de
 *      credenciales o verificación de firma (design.md "Webhook — after").
 *   3. Gating por conexión de la cuenta (RECONNECT_REQUIRED) y
 *      desconexión self-service (spec "Self-Service Disconnection").
 *
 * Mismo patrón de fixtures que calendar-integration.e2e-spec.ts: usuarios
 * creados vía HTTP + enrolamiento MFA forzado; la PaymentAccount de cada
 * terapeuta se inserta directo vía Prisma (bypass del wizard real -- sin
 * sandbox de Flow disponible, mismo criterio que
 * calendar-integration.e2e-spec.ts's stubExchange), cifrando un par
 * apiKey/secretKey de fixture con la instancia real de
 * PaymentCredentialCryptoService resuelta por Nest (así resolveGatewayContext
 * descifra un blob v2 genuino). PaymentGatewayClient.createOrder/
 * getOrderStatus se stubean con jest.spyOn sobre la instancia real resuelta
 * por Nest -- solo la llamada de red se reemplaza; verifyCallbackSignature
 * corre SIN mockear, firmando con el secretKey de fixture (conocido por el
 * test, nunca por variable de entorno).
 */
describe('Payments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let gateway: PaymentGatewayClient;
  let credentialCrypto: PaymentCredentialCryptoService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';
  // Fixture credentials (well-formed per PaymentAccountService's
  // CREDENTIAL_FORMAT gate: 16-128 chars, [A-Za-z0-9_-]) -- known to the
  // test so `sign()` can compute a genuine callback signature the same way
  // FlowPaymentGatewayClient.verifyCallbackSignature would.
  const THERAPIST_A_API_KEY = 'e2eTestApiKeyTherapistA';
  const THERAPIST_A_SECRET_KEY = 'e2eTestSecretKeyTherapistA';

  let therapistAToken: string;
  let therapistBToken: string;
  let therapistAId: string;
  let therapistBId: string;
  let patientAId: string;
  let groupIdA: string;

  function sign(params: Record<string, string>): string {
    const sortedKeys = Object.keys(params).sort();
    const toSign = sortedKeys.map((k) => `${k}${params[k]}`).join('');
    return createHmac('sha256', THERAPIST_A_SECRET_KEY)
      .update(toSign)
      .digest('hex');
  }

  async function createProfessionalAndLogin(
    email: string,
    name: string,
  ): Promise<{ id: string; token: string }> {
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email, passwordHash, name },
    });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);
    expect((login.body as Record<string, unknown>).requiresMfaSetup).toBe(true);

    const beginSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({
        setupToken: (login.body as Record<string, unknown>)
          .setupToken as string,
      })
      .expect(201);

    const totp = speakeasy.totp({
      secret: (beginSetup.body as Record<string, unknown>).secret as string,
      encoding: 'base32',
    });

    const confirmSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({
        setupToken: (login.body as Record<string, unknown>)
          .setupToken as string,
        token: totp,
      })
      .expect(201);

    return {
      id: user.id,
      token: (confirmSetup.body as Record<string, unknown>)
        .accessToken as string,
    };
  }

  function encryptCredentials(apiKey: string, secretKey: string): Buffer {
    return credentialCrypto.encrypt(
      Buffer.from(JSON.stringify({ apiKey, secretKey }), 'utf-8'),
    );
  }

  // El fire-and-forget de ConsultationsService.emitPaymentCharge (PR 1)
  // significa que POST /consultations puede devolver 201 antes de que
  // ensureCharge()+issueOrder() terminen -- mismo criterio de poll acotado
  // que consultations.service.integration.spec.ts (PR 1, "waitForPayment"),
  // acá contra la fila Payment real vía Prisma.
  async function waitForPayment(
    groupId: string,
    predicate: (payment: { gatewayToken: string | null }) => boolean,
    timeoutMs = 3000,
  ): Promise<{ id: string; gatewayToken: string | null; amount: number }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const payment = await prisma.payment.findUnique({ where: { groupId } });
      if (payment && predicate(payment)) return payment;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timeout esperando el Payment de groupId=${groupId}`);
  }

  // 90s: argon2.hash (creación de cada terapeuta de prueba) toma ~10s en
  // este entorno -- dos terapeutas + setup MFA + fixtures de paciente/
  // consulta se acercan al default de Jest (30s) sin margen. Mismo criterio
  // de timeout ampliado que otros e2e-spec de este proyecto con múltiples
  // usuarios de fixture.
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);
    gateway = app.get(PaymentGatewayClient);
    credentialCrypto = app.get(PaymentCredentialCryptoService);

    const therapistA = await createProfessionalAndLogin(
      `payments.therapist.a.${runId}@umbral.cl`,
      'Payments Therapist A',
    );
    therapistAId = therapistA.id;
    therapistAToken = therapistA.token;

    const therapistB = await createProfessionalAndLogin(
      `payments.therapist.b.${runId}@umbral.cl`,
      'Payments Therapist B',
    );
    therapistBId = therapistB.id;
    therapistBToken = therapistB.token;

    // Bypass del wizard real (sin sandbox de Flow disponible esta sesión)
    // -- inserta la PaymentAccount de A ya CONNECTED con un blob v2
    // genuino, exactamente lo que PaymentAccountService.connect() dejaría
    // persistido.
    await prisma.paymentAccount.create({
      data: {
        therapistId: therapistAId,
        provider: 'FLOW',
        status: 'CONNECTED',
        credentialVersion: 2,
        credentialEncrypted: Uint8Array.from(
          encryptCredentials(THERAPIST_A_API_KEY, THERAPIST_A_SECRET_KEY),
        ),
        keyFingerprint: 'e2e-fixture-fingerprint',
        connectedAt: new Date(),
      },
    });

    jest.spyOn(gateway, 'createOrder').mockResolvedValue({
      token: 'flow-token-e2e',
      paymentUrl:
        'https://sandbox.flow.cl/app/web/pay.php?token=flow-token-e2e',
    });

    const patient = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .send({
        fullName: 'Paciente E2E Pagos',
        rut: `e2e-payments-a-${runId}`,
        birthDate: '1990-01-01',
        defaultSessionAmount: 30000,
      })
      .expect(201);
    patientAId = (patient.body as { id: string }).id;

    const consultation = await request(app.getHttpServer())
      .post('/api/v1/consultations')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .send({
        patientId: patientAId,
        sessionDate: '2026-09-20',
        consultReason: 'Motivo E2E',
        intervention: 'Intervención E2E',
      })
      .expect(201);
    groupIdA = (consultation.body as { groupId: string }).groupId;

    await waitForPayment(groupIdA, (p) => p.gatewayToken === 'flow-token-e2e');
  }, 90000);

  afterAll(async () => {
    try {
      await prisma.payment.deleteMany({ where: { groupId: groupIdA } });
      await prisma.paymentAccount.deleteMany({
        where: { therapistId: { in: [therapistAId, therapistBId] } },
      });
      await prisma.consultation.deleteMany({ where: { groupId: groupIdA } });
      if (patientAId) {
        await prisma.patient.deleteMany({ where: { id: patientAId } });
      }
      await prisma.user.updateMany({
        where: { id: { in: [therapistAId, therapistBId] } },
        data: { deletedAt: new Date() },
      });
    } finally {
      await app.close();
    }
  });

  describe('Guard sin token', () => {
    it('GET /payments/account sin Authorization header devuelve 401', () => {
      return request(app.getHttpServer())
        .get('/api/v1/payments/account')
        .expect(401);
    });

    it('PATCH /payments/:groupId sin Authorization header devuelve 401', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/payments/${groupIdA}`)
        .send({ amount: 1000 })
        .expect(401);
    });
  });

  describe('Tenancy — GET/DELETE /payments/account nunca exponen ni mutan la cuenta de otro terapeuta', () => {
    it('terapeuta B ve PENDING (nunca la cuenta CONNECTED de A)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/payments/account')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(200);

      expect((res.body as { status: string }).status).toBe('PENDING');
      expect(res.body).not.toHaveProperty('credentialEncrypted');
    });

    it('terapeuta A sí ve su propia cuenta CONNECTED (sin exponer el secreto)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/payments/account')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);

      expect((res.body as { status: string }).status).toBe('CONNECTED');
      expect((res.body as { keyFingerprint: string }).keyFingerprint).toBe(
        'e2e-fixture-fingerprint',
      );
      expect(res.body).not.toHaveProperty('credentialEncrypted');
      expect(res.body).not.toHaveProperty('apiKey');
      expect(res.body).not.toHaveProperty('secretKey');
    });

    it('DELETE /account de terapeuta B nunca desconecta la cuenta de A (404 uniforme)', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/payments/account')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(404);

      const accountA = await prisma.paymentAccount.findUnique({
        where: { therapistId: therapistAId },
      });
      expect(accountA?.status).toBe('CONNECTED');
    });
  });

  describe('Tenancy — PATCH /payments/:groupId nunca expone ni muta el cargo de otro terapeuta', () => {
    it('terapeuta B recibe 404 (nunca 403-with-leak) y el cargo de A no cambia', async () => {
      const before = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/payments/${groupIdA}`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .send({ amount: 99999 })
        .expect(404);

      const after = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });
      expect(after?.amount).toBe(before?.amount);
    });

    it('un groupId inexistente también devuelve 404 (mismo tratamiento que el de otro terapeuta)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/payments/groupid-que-no-existe')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({ amount: 1000 })
        .expect(404);
    });

    it('el dueño (terapeuta A) sí puede modificar su propio cargo', async () => {
      jest.spyOn(gateway, 'createOrder').mockResolvedValue({
        token: 'flow-token-e2e-updated',
        paymentUrl:
          'https://sandbox.flow.cl/app/web/pay.php?token=flow-token-e2e-updated',
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/payments/${groupIdA}`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({ amount: 45000 })
        .expect(200);

      expect((res.body as { amount: number }).amount).toBe(45000);
    });
  });

  // sdd/payments-multigateway-redesign task 3.8 + spec.md "Automatic Charge
  // Creation Gated by Gateway Connection", scenario "Therapist requiring
  // reconnection schedules without a charge": a therapist whose account was
  // flagged RECONNECT_REQUIRED (M2's legacy-migration outcome) still
  // schedules successfully -- the clinical write is never blocked -- but no
  // Payment row is created for that consultation.
  describe('Gating por conexión — cuenta RECONNECT_REQUIRED', () => {
    let therapistCId: string;
    let therapistCToken: string;
    let patientCId: string;

    beforeAll(async () => {
      const therapistC = await createProfessionalAndLogin(
        `payments.therapist.c.${runId}@umbral.cl`,
        'Payments Therapist C',
      );
      therapistCId = therapistC.id;
      therapistCToken = therapistC.token;

      await prisma.paymentAccount.create({
        data: {
          therapistId: therapistCId,
          provider: 'FLOW',
          status: 'RECONNECT_REQUIRED',
          credentialVersion: 1,
          lastError: 'Reconexión requerida (fixture e2e M2).',
        },
      });

      const patient = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${therapistCToken}`)
        .send({
          fullName: 'Paciente E2E Reconexión',
          rut: `e2e-payments-c-${runId}`,
          birthDate: '1990-01-01',
          defaultSessionAmount: 25000,
        })
        .expect(201);
      patientCId = (patient.body as { id: string }).id;
    }, 30000);

    afterAll(async () => {
      await prisma.paymentAccount.deleteMany({
        where: { therapistId: therapistCId },
      });
      await prisma.consultation.deleteMany({
        where: { therapistId: therapistCId },
      });
      if (patientCId) {
        await prisma.patient.deleteMany({ where: { id: patientCId } });
      }
      await prisma.user.updateMany({
        where: { id: therapistCId },
        data: { deletedAt: new Date() },
      });
    });

    it('la consulta se crea igual (201) pero no se genera un Payment', async () => {
      const consultation = await request(app.getHttpServer())
        .post('/api/v1/consultations')
        .set('Authorization', `Bearer ${therapistCToken}`)
        .send({
          patientId: patientCId,
          sessionDate: '2026-09-21',
          consultReason: 'Motivo E2E reconexión',
          intervention: 'Intervención E2E reconexión',
        })
        .expect(201);
      const groupIdC = (consultation.body as { groupId: string }).groupId;

      // No hay callback ni cron que crear un Payment de forma asíncrona en
      // este flujo -- una breve espera cubre el mismo fire-and-forget que
      // waitForPayment normalmente sondea, confirmando la AUSENCIA en vez
      // de la presencia de la fila.
      await new Promise((resolve) => setTimeout(resolve, 300));

      const payment = await prisma.payment.findUnique({
        where: { groupId: groupIdC },
      });
      expect(payment).toBeNull();
    });
  });

  describe('POST /payments/confirm (público) — un body forjado nunca muta un Payment', () => {
    it('firma inválida se rechaza con 400 y el Payment no cambia', async () => {
      const before = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });

      await request(app.getHttpServer())
        .post('/api/v1/payments/confirm')
        .send({ token: before?.gatewayToken, s: 'firma-completamente-falsa' })
        .expect(400);

      const after = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });
      expect(after?.status).toBe(before?.status);
      expect(after?.paidAt).toBeNull();
    });

    // sdd/payments-multigateway-redesign task 3.7 + spec "Checkout is
    // unavailable if the owning account is no longer connected": a token
    // that matches no Payment row rejects with the same uniform 400 --
    // this proves the read-only lookup (findByToken) runs and fails BEFORE
    // any credential resolution, decryption, or signature check, with zero
    // mutation anywhere in the module.
    it('token desconocido se rechaza con 400 sin mutar ningún Payment', async () => {
      const beforeA = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });

      await request(app.getHttpServer())
        .post('/api/v1/payments/confirm')
        .send({
          token: 'token-que-no-existe-en-ningun-payment',
          s: 'x'.repeat(64),
        })
        .expect(400);

      const afterA = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });
      expect(afterA?.status).toBe(beforeA?.status);
      expect(afterA?.paidAt).toBeNull();
    });

    it('sin el campo s (whitelist/forbidNonWhitelisted) se rechaza con 400 antes de cualquier lógica de negocio', async () => {
      const before = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });

      await request(app.getHttpServer())
        .post('/api/v1/payments/confirm')
        .send({ token: before?.gatewayToken })
        .expect(400);
    });

    it('un campo extra no declarado se rechaza con 400 (forbidNonWhitelisted)', async () => {
      const before = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });
      const s = sign({ token: before!.gatewayToken! });

      await request(app.getHttpServer())
        .post('/api/v1/payments/confirm')
        .send({
          token: before?.gatewayToken,
          s,
          extra: 'campo-inyectado-por-un-atacante',
        })
        .expect(400);

      const after = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });
      expect(after?.status).toBe(before?.status);
    });

    it('una firma válida (firmada con el secretKey real de la cuenta dueña) re-consulta getOrderStatus (stubeado) y confirma el pago', async () => {
      const before = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });
      jest.spyOn(gateway, 'getOrderStatus').mockResolvedValue({
        status: 'PAID',
        gatewayPaymentId: 'flow-payment-e2e',
      });
      const s = sign({ token: before!.gatewayToken! });

      await request(app.getHttpServer())
        .post('/api/v1/payments/confirm')
        .send({ token: before?.gatewayToken, s })
        .expect(200);

      const after = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });
      expect(after?.status).toBe('PAID');
      expect(after?.paidAt).not.toBeNull();

      jest.restoreAllMocks();
    });

    it('una confirmación repetida (replay) sobre el mismo cargo ya PAID es un no-op', async () => {
      const before = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });
      expect(before?.status).toBe('PAID');
      const s = sign({ token: before!.gatewayToken! });

      await request(app.getHttpServer())
        .post('/api/v1/payments/confirm')
        .send({ token: before?.gatewayToken, s })
        .expect(200);

      const after = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });
      expect(after?.paidAt?.getTime()).toBe(before?.paidAt?.getTime());
    });
  });

  // sdd/payments-multigateway-redesign task 3.9 + spec "Self-Service
  // Disconnection": runs LAST -- it permanently disconnects therapist A's
  // account, which every earlier describe() block in this file depends on
  // being CONNECTED.
  describe('Self-Service Disconnection — DELETE /payments/account (terapeuta A sobre su propia cuenta)', () => {
    it('desconecta la cuenta (200), deja el cargo pendiente existente intacto, y una consulta nueva no genera cargo', async () => {
      const existingPaymentBefore = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });

      const res = await request(app.getHttpServer())
        .delete('/api/v1/payments/account')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);
      expect((res.body as { status: string }).status).toBe('DISCONNECTED');

      const accountAfter = await prisma.paymentAccount.findUnique({
        where: { therapistId: therapistAId },
      });
      expect(accountAfter?.status).toBe('DISCONNECTED');

      // spec "Self-Service Disconnection": "MUST NOT alter charges already
      // created before disconnection" -- the PAID charge from the earlier
      // confirm() block stays bit-for-bit identical.
      const existingPaymentAfter = await prisma.payment.findUnique({
        where: { groupId: groupIdA },
      });
      expect(existingPaymentAfter).toEqual(existingPaymentBefore);

      // A new consultation for the now-disconnected therapist A succeeds
      // (scheduling is never blocked) but gets no automatic charge.
      const newConsultation = await request(app.getHttpServer())
        .post('/api/v1/consultations')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          patientId: patientAId,
          sessionDate: '2026-09-25',
          consultReason: 'Motivo E2E post-desconexión',
          intervention: 'Intervención E2E post-desconexión',
        })
        .expect(201);
      const groupIdAfterDisconnect = (
        newConsultation.body as { groupId: string }
      ).groupId;

      await new Promise((resolve) => setTimeout(resolve, 300));

      const newPayment = await prisma.payment.findUnique({
        where: { groupId: groupIdAfterDisconnect },
      });
      expect(newPayment).toBeNull();

      await prisma.consultation.deleteMany({
        where: { groupId: groupIdAfterDisconnect },
      });
    });
  });
});
