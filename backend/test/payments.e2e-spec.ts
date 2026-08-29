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

/**
 * sdd/online-payment-integration PR 2 (T7.7-7.10, design.md "Testing
 * Strategy" -- "E2E: tenancy (uniform 404) and forged public confirm never
 * mutates a Payment"): las dos superficies de seguridad que design.md exige
 * como RED E2E obligatorio para este módulo:
 *   1. Tenancy: GET/DELETE /payments/account y PATCH /payments/:groupId
 *      quedan scoped exclusivamente al terapeuta autenticado
 *      (@CurrentUser(), nunca un :id que identifique la cuenta/cargo de
 *      otro) -- terapeuta B nunca ve ni puede mutar la cuenta o el cargo de
 *      terapeuta A, siempre con el mismo 404 uniforme.
 *   2. POST /payments/confirm es la ÚNICA ruta pública del módulo (sin
 *      JwtAuthGuard) -- un body forjado, sin firma, o con campos extra
 *      jamás debe mutar un Payment.
 *
 * Mismo patrón de fixtures que calendar-integration.e2e-spec.ts: usuarios
 * creados vía HTTP + enrolamiento MFA forzado; la conexión Flow de
 * terapeuta A se inserta directo vía Prisma (bypass del onboarding real --
 * sin sandbox de Flow disponible, mismo criterio que
 * calendar-integration.e2e-spec.ts's stubExchange) y
 * PaymentGatewayClient.createOrder/getOrderStatus se stubean con jest.spyOn
 * sobre la instancia real resuelta por Nest -- solo la llamada de red se
 * reemplaza, verifyCallbackSignature corre SIN mockear (necesita
 * FLOW_SECRET_KEY configurada en el entorno que corre este archivo).
 */
describe('Payments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let gateway: PaymentGatewayClient;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';
  const FLOW_SECRET_KEY = process.env.FLOW_SECRET_KEY ?? '';

  let therapistAToken: string;
  let therapistBToken: string;
  let therapistAId: string;
  let therapistBId: string;
  let patientAId: string;
  let groupIdA: string;

  function sign(params: Record<string, string>): string {
    const sortedKeys = Object.keys(params).sort();
    const toSign = sortedKeys.map((k) => `${k}${params[k]}`).join('');
    return createHmac('sha256', FLOW_SECRET_KEY).update(toSign).digest('hex');
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

    // Bypass del onboarding real (sin sandbox de Flow disponible esta
    // sesión) -- inserta la PaymentAccount de A ya CONNECTED, exactamente
    // lo que PaymentAccountService.onboard() dejaría persistido.
    await prisma.paymentAccount.create({
      data: {
        therapistId: therapistAId,
        provider: 'FLOW',
        status: 'CONNECTED',
        merchantId: 'merchant-a-e2e',
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
        rut: '11111111-1',
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
      expect((res.body as { merchantId: string | null }).merchantId).toBeNull();
    });

    it('terapeuta A sí ve su propia cuenta CONNECTED', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/payments/account')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);

      expect((res.body as { status: string }).status).toBe('CONNECTED');
      expect((res.body as { merchantId: string }).merchantId).toBe(
        'merchant-a-e2e',
      );
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

    it('una firma válida re-consulta getOrderStatus (stubeado) y confirma el pago', async () => {
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
});
