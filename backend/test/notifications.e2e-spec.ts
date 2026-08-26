import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * sdd/session-reminders PR 1 (T3.3-T3.7): notifications es la primera
 * superficie HTTP nueva del capability in-app-notifications -- estos e2e
 * cubren exactamente los dos invariantes de seguridad que el design.md deja
 * como RED obligatorio en vez de matriz de amenazas:
 *   1. Aislamiento de tenancy: terapeuta B nunca ve ni puede mutar
 *      notificaciones de terapeuta A (404, nunca 403 -- mismo criterio que
 *      rbac-ownership.e2e-spec.ts, issue #30).
 *   2. Orden de rutas: GET /notifications/unread-count debe resolver antes
 *      que GET /notifications/:id (que en este capability no existe como
 *      ruta, pero el mismo wildcard trap de Express 5 aplica a
 *      PATCH /notifications/:id/read -- unread-count es GET de un solo
 *      segmento y no colisiona con ningún :id de ese verbo, así que el test
 *      confirma directamente que el literal resuelve al handler correcto y
 *      no es tragado por ninguna ruta paramétrica).
 *
 * Mismo patrón de fixtures que rbac-ownership.e2e-spec.ts: usuarios creados
 * directo vía Prisma + enrolamiento MFA forzado (login -> mfa/setup/begin ->
 * mfa/setup/confirm), porque no existe POST /users tras el colapso de roles.
 */
describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';

  let therapistAToken: string;
  let therapistBToken: string;
  let therapistAId: string;
  let therapistBId: string;

  let notificationAId: string;

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

  // Timeout explícito: el bootstrap de AppModule + 2 altas completas
  // (argon2.hash + login + mfa/setup/begin + mfa/setup/confirm cada una)
  // supera el default de Jest (5000ms) en un cold run de este suite.
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

    const therapistA = await createProfessionalAndLogin(
      `notif.therapist.a.${runId}@umbral.cl`,
      'Notif Therapist A',
    );
    therapistAId = therapistA.id;
    therapistAToken = therapistA.token;

    const therapistB = await createProfessionalAndLogin(
      `notif.therapist.b.${runId}@umbral.cl`,
      'Notif Therapist B',
    );
    therapistBId = therapistB.id;
    therapistBToken = therapistB.token;

    // Notificación de A creada directo vía Prisma (no hay POST /notifications
    // -- create() lo llama internamente RemindersService en PR 2).
    const notification = await prisma.notification.create({
      data: {
        userId: therapistAId,
        type: 'SESSION_REMINDER',
        title: 'Sesión en 24 horas',
        body: 'Tienes una sesión programada mañana a esta hora',
      },
    });
    notificationAId = notification.id;
  }, 30000);

  afterAll(async () => {
    try {
      if (notificationAId) {
        await prisma.notification.deleteMany({
          where: { id: notificationAId },
        });
      }
      const idsToSoftDelete = [therapistAId, therapistBId].filter(Boolean);
      if (idsToSoftDelete.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: idsToSoftDelete } },
          data: { deletedAt: new Date() },
        });
      }
    } finally {
      await app.close();
    }
  });

  describe('Guard sin token', () => {
    it('GET /notifications sin Authorization header devuelve 401', () => {
      return request(app.getHttpServer())
        .get('/api/v1/notifications')
        .expect(401);
    });

    it('GET /notifications/unread-count sin Authorization header devuelve 401', () => {
      return request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .expect(401);
    });
  });

  describe('GET /notifications/unread-count (orden de rutas)', () => {
    it('resuelve el literal "unread-count", no un :id paramétrico', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);

      // Si "unread-count" fuera tragado por una ruta :id, el handler
      // devolvería 404 (notificación inexistente) en vez de { count }.
      expect(res.body).toEqual({ count: 1 });
    });
  });

  describe('Aislamiento de tenancy (RED first)', () => {
    it('GET /notifications de terapeuta B nunca incluye notificaciones de A', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(200);

      const ids = (res.body as Array<{ id: string }>).map((n) => n.id);
      expect(ids).not.toContain(notificationAId);
    });

    it('GET /notifications/unread-count de terapeuta B no cuenta las de A', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(200);

      expect(res.body).toEqual({ count: 0 });
    });

    it('PATCH /notifications/:id/read de terapeuta B sobre notificación de A devuelve 404', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${notificationAId}/read`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(404);

      // La notificación de A sigue sin leer -- el intento no autorizado no
      // tuvo ningún efecto.
      const stillUnread = await prisma.notification.findUnique({
        where: { id: notificationAId },
      });
      expect(stillUnread?.readAt).toBeNull();
    });

    it('el dueño (terapeuta A) sí puede marcarla leída', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${notificationAId}/read`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);

      expect((res.body as Record<string, unknown>).readAt).not.toBeNull();
    });
  });
});
