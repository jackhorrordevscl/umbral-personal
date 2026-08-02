import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SEED_ADMIN_EMAIL_DEFAULT,
  SEED_ADMIN_PASSWORD_DEFAULT,
} from '../prisma/seed-admin.defaults';

/**
 * T6.1 (issue #27): consentimiento granular por finalidad (Ley 21.719).
 * Verifica que cada finalidad (TREATMENT, TELEMEDICINE, HEALTH_NETWORK) se
 * pueda otorgar/revocar de forma independiente, que cada evento quede
 * registrado en el ledger append-only PatientConsent con actor y fecha, y
 * que el control de acceso sea el mismo que el resto de las mutaciones del
 * módulo (findOne: dueño, o SUPERVISOR si HEALTH_NETWORK ya está otorgado --
 * T6.4, issue #51. ADMIN ya no tiene acceso, ni siquiera para registrar).
 */
describe('Patient consent ledger (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? SEED_ADMIN_EMAIL_DEFAULT;
  const ADMIN_PASSWORD =
    process.env.SEED_ADMIN_PASSWORD ?? SEED_ADMIN_PASSWORD_DEFAULT;
  const TEST_PASSWORD = 'TestPass123!';

  let adminToken: string;
  let therapistAToken: string;
  let therapistBToken: string;
  let therapistAId: string;
  let therapistBId: string;

  let patientId: string;

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

    // T4.1 (issue #19): ADMIN/SUPERVISOR quedan forzados a enrolar MFA en su
    // primer login sin MFA. Se resetea el estado MFA del ADMIN seedeado
    // antes de loguear, igual que en rbac-ownership.e2e-spec.ts.
    await prisma.user.updateMany({
      where: { email: ADMIN_EMAIL },
      data: { mfaEnabled: false, mfaSecret: null, mustChangePassword: false },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(201);
    expect(adminLogin.body.requiresMfaSetup).toBe(true);

    const beginSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({ setupToken: adminLogin.body.setupToken })
      .expect(201);

    const adminTotp = speakeasy.totp({
      secret: beginSetup.body.secret,
      encoding: 'base32',
    });

    const confirmSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({ setupToken: adminLogin.body.setupToken, token: adminTotp })
      .expect(201);
    adminToken = confirmSetup.body.accessToken;

    const therapistAEmail = `consent.therapist.a.${runId}@umbral.cl`;
    const therapistBEmail = `consent.therapist.b.${runId}@umbral.cl`;

    const therapistACreate = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: therapistAEmail,
        password: TEST_PASSWORD,
        name: 'Consent Therapist A',
        role: 'THERAPIST',
      })
      .expect(201);
    therapistAId = therapistACreate.body.id;

    const therapistBCreate = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: therapistBEmail,
        password: TEST_PASSWORD,
        name: 'Consent Therapist B',
        role: 'THERAPIST',
      })
      .expect(201);
    therapistBId = therapistBCreate.body.id;

    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: therapistAEmail, password: TEST_PASSWORD })
      .expect(201);
    therapistAToken = loginA.body.accessToken;

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: therapistBEmail, password: TEST_PASSWORD })
      .expect(201);
    therapistBToken = loginB.body.accessToken;

    const patientCreate = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .send({
        fullName: 'Consent Test Patient',
        rut: `CONSENT${runId}`,
        birthDate: '1990-01-01',
      })
      .expect(201);
    patientId = patientCreate.body.id;
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

      // El beforeAll enrola MFA en el admin seedeado; ningún test posterior
      // lo deshace. Mismo patrón que auth-mfa-enforcement/rbac-ownership: sin
      // este reset, el admin queda con un mfaSecret de test inservible para
      // cualquiera que loguee después.
      await prisma.user.updateMany({
        where: { email: ADMIN_EMAIL },
        data: { mfaEnabled: false, mfaSecret: null },
      });
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

      expect(res.body.purpose).toBe('TREATMENT');
      expect(res.body.action).toBe('GRANT');
      expect(res.body.recordedById).toBe(therapistAId);
      expect(res.body.recordedAt).toBeDefined();

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

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .send({
          purpose: 'TELEMEDICINE',
          action: 'GRANT',
          evidence: 'Intento no autorizado de otorgar telemedicina',
        })
        .expect(403);
    });

    it('el terapeuta dueño otorga HEALTH_NETWORK (2xx)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          purpose: 'HEALTH_NETWORK',
          action: 'GRANT',
          evidence: 'Paciente autoriza compartir con la red de salud',
        })
        .expect(201);
    });

    it('ADMIN recibe 403 al intentar registrar consentimiento (T6.4, issue #51)', () => {
      return request(app.getHttpServer())
        .post(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          purpose: 'HEALTH_NETWORK',
          action: 'GRANT',
          evidence: 'ADMIN ya no tiene acceso a datos clínicos de pacientes',
        })
        .expect(403);
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
      // HEALTH_NETWORK: GRANT (por el terapeuta dueño) -> true
      // TELEMEDICINE: sin eventos exitosos -> false
      const res = await request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}/consents/status`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);

      expect(res.body).toEqual({
        TREATMENT: false,
        TELEMEDICINE: false,
        HEALTH_NETWORK: true,
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
        HEALTH_NETWORK: true,
      });
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}/consents/status`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });
  });

  describe('GET /patients/:id/consents', () => {
    it('el terapeuta dueño puede ver el ledger completo (2xx)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(4);
      expect(res.body[0].recordedBy).toBeDefined();
      expect(res.body[0].recordedBy.id).toBeDefined();
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}/consents`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });
  });
});
