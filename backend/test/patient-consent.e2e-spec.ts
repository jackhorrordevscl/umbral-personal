import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * T6.1 (issue #27): consentimiento granular por finalidad (Ley 21.719).
 * Verifica que cada finalidad (TREATMENT, TELEMEDICINE) se pueda
 * otorgar/revocar de forma independiente, que cada evento quede registrado
 * en el ledger append-only PatientConsent con actor y fecha, y que el
 * control de acceso sea el mismo que el resto de las mutaciones del módulo:
 * dueño único (Patient.therapistId === userId), sin ramas ADMIN/SUPERVISOR
 * tras el colapso de roles (b0354c0, issue #7). HEALTH_NETWORK se eliminó
 * del enum (issue #6): era la finalidad exclusiva del acceso excepcional de
 * SUPERVISOR a la red de salud, que ya no existe.
 *
 * No existe POST /users tras el colapso de roles (era CRUD institucional,
 * reemplazado por ProfileModule): los fixtures se crean directo vía Prisma
 * con argon2, y pasan por el enrolamiento MFA forzado (obligatorio para toda
 * cuenta) antes de tener un accessToken de sesión.
 */
describe('Patient consent ledger (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';

  let therapistAToken: string;
  let therapistBToken: string;
  let therapistAId: string;
  let therapistBId: string;

  let patientId: string;

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
      `consent.therapist.a.${runId}@umbral.cl`,
      'Consent Therapist A',
    );
    therapistAId = therapistA.id;
    therapistAToken = therapistA.token;

    const therapistB = await createProfessionalAndLogin(
      `consent.therapist.b.${runId}@umbral.cl`,
      'Consent Therapist B',
    );
    therapistBId = therapistB.id;
    therapistBToken = therapistB.token;

    const patientCreate = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .send({
        fullName: 'Consent Test Patient',
        rut: `CONSENT${runId}`,
        birthDate: '1990-01-01',
      })
      .expect(201);
    patientId = (patientCreate.body as Record<string, unknown>).id as string;
  });

  afterAll(async () => {
    try {
      if (patientId) {
        await prisma.patientConsent.deleteMany({ where: { patientId } });
        await prisma.patient.deleteMany({ where: { id: patientId } });
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
    it('POST /patients/:id/consents sin Authorization header devuelve 401', () => {
      return request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/consents`)
        .send({
          purpose: 'TREATMENT',
          action: 'GRANT',
          evidence: 'Sin autenticar',
        })
        .expect(401);
    });
  });

  describe('POST /patients/:id/consents', () => {
    it('el terapeuta dueño otorga TREATMENT (2xx) y queda registrado en el ledger', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          purpose: 'TREATMENT',
          action: 'GRANT',
          evidence: 'Firma en papel escaneada durante primera sesión',
        })
        .expect(201);

      expect((res.body as Record<string, unknown>).purpose).toBe('TREATMENT');
      expect((res.body as Record<string, unknown>).action).toBe('GRANT');
      expect((res.body as Record<string, unknown>).recordedById).toBe(
        therapistAId,
      );
      expect((res.body as Record<string, unknown>).recordedAt).toBeDefined();

      const ledger = await prisma.patientConsent.findMany({
        where: { patientId, purpose: 'TREATMENT' },
      });
      expect(ledger.length).toBe(1);
      expect(ledger[0].action).toBe('GRANT');
      expect(ledger[0].recordedById).toBe(therapistAId);
    });

    it('el terapeuta dueño revoca TREATMENT (2xx) sin borrar el evento anterior', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          purpose: 'TREATMENT',
          action: 'REVOKE',
          evidence: 'Paciente solicitó revocar consentimiento de tratamiento',
        })
        .expect(201);

      const ledger = await prisma.patientConsent.findMany({
        where: { patientId, purpose: 'TREATMENT' },
        orderBy: { recordedAt: 'asc' },
      });
      expect(ledger.length).toBe(2);
      expect(ledger[0].action).toBe('GRANT');
      expect(ledger[1].action).toBe('REVOKE');
    });

    it('un terapeuta sin relación con el paciente recibe 404', () => {
      return request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .send({
          purpose: 'TELEMEDICINE',
          action: 'GRANT',
          evidence: 'Intento no autorizado de otorgar telemedicina',
        })
        .expect(404);
    });

    it('rechaza purpose HEALTH_NETWORK, eliminado del enum (issue #6) (400)', () => {
      return request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          purpose: 'HEALTH_NETWORK',
          action: 'GRANT',
          evidence: 'Finalidad que ya no existe en este producto',
        })
        .expect(400);
    });

    it('rechaza evidence menor a 10 caracteres (400)', () => {
      return request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          purpose: 'TELEMEDICINE',
          action: 'GRANT',
          evidence: 'corta',
        })
        .expect(400);
    });
  });

  describe('GET /patients/:id/consents/status', () => {
    it('refleja estado independiente por finalidad tras una mezcla de grants/revokes', async () => {
      // Estado esperado según los eventos previos:
      // TREATMENT: GRANT luego REVOKE -> false
      // TELEMEDICINE: sin eventos exitosos -> false
      const res = await request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}/consents/status`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);

      expect(res.body).toEqual({
        TREATMENT: false,
        TELEMEDICINE: false,
      });

      // Otorgar TELEMEDICINE de forma independiente no debe alterar los demás
      await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          purpose: 'TELEMEDICINE',
          action: 'GRANT',
          evidence: 'Firma de acuerdo de telemedicina en plataforma',
        })
        .expect(201);

      const res2 = await request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}/consents/status`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);

      expect(res2.body).toEqual({
        TREATMENT: false,
        TELEMEDICINE: true,
      });
    });

    it('un terapeuta sin relación con el paciente recibe 404', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}/consents/status`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(404);
    });
  });

  describe('GET /patients/:id/consents', () => {
    it('el terapeuta dueño puede ver el ledger completo (2xx)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(
        (res.body as Record<string, unknown>).length,
      ).toBeGreaterThanOrEqual(3);
      expect(
        (res.body as Record<string, unknown>[])[0].recordedBy,
      ).toBeDefined();
      expect(
        (
          (res.body as Record<string, unknown>[])[0].recordedBy as Record<
            string,
            unknown
          >
        ).id,
      ).toBeDefined();
    });

    it('un terapeuta sin relación con el paciente recibe 404', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(404);
    });
  });
});
