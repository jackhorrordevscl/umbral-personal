import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { uniqueTestRut } from './support/unique-rut';

type Body = Record<string, unknown>;

/**
 * M2a: representantes legales de un paciente (`/patients/:patientId/guardians`)
 * y los campos de edad/estado de regularización (`isMinor`, `ageBand`,
 * `minorStatus`) en las respuestas de paciente. Los fixtures siguen el patrón
 * de patient-consent.e2e-spec.ts (usuarios por Prisma + enrolamiento MFA).
 */
describe('Patient guardians (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';
  const patientIds: string[] = [];

  let tokenA: string;
  let tokenB: string;
  let therapistAId: string;
  let therapistBId: string;

  function yearsAgoDate(years: number): string {
    const date = new Date();
    date.setUTCFullYear(date.getUTCFullYear() - years);
    return date.toISOString().slice(0, 10);
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

    const beginSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({ setupToken: (login.body as Body).setupToken as string })
      .expect(201);

    const totp = speakeasy.totp({
      secret: (beginSetup.body as Body).secret as string,
      encoding: 'base32',
    });

    const confirmSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({
        setupToken: (login.body as Body).setupToken as string,
        token: totp,
      })
      .expect(201);

    return {
      id: user.id,
      token: (confirmSetup.body as Body).accessToken as string,
    };
  }

  async function createPatient(
    token: string,
    birthDate: string,
    name = 'Guardians Test Patient',
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: name, rut: uniqueTestRut(), birthDate })
      .expect(201);
    const id = (res.body as Body).id as string;
    patientIds.push(id);
    return id;
  }

  const guardianBody = (overrides: Body = {}) => ({
    fullName: 'María Soto',
    rut: uniqueTestRut(),
    relationship: 'MOTHER',
    ...overrides,
  });

  function postGuardian(token: string, patientId: string, body: Body) {
    return request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/guardians`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function getPatient(token: string, patientId: string): Promise<Body> {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as Body;
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

    const a = await createProfessionalAndLogin(
      `guardians.a.${runId}@umbral.cl`,
      'Guardians Therapist A',
    );
    therapistAId = a.id;
    tokenA = a.token;

    const b = await createProfessionalAndLogin(
      `guardians.b.${runId}@umbral.cl`,
      'Guardians Therapist B',
    );
    therapistBId = b.id;
    tokenB = b.token;
  });

  afterAll(async () => {
    try {
      if (patientIds.length > 0) {
        // PatientConsent.guardianId is RESTRICT: consents go first.
        await prisma.patientConsent.deleteMany({
          where: { patientId: { in: patientIds } },
        });
        await prisma.legalGuardian.deleteMany({
          where: { patientId: { in: patientIds } },
        });
        await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
      }
      const userIds = [therapistAId, therapistBId].filter(Boolean);
      if (userIds.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: { deletedAt: new Date() },
        });
      }
    } finally {
      await app.close();
    }
  });

  describe('autenticación', () => {
    it('GET sin token devuelve 401', () => {
      return request(app.getHttpServer())
        .get('/api/v1/patients/any-id/guardians')
        .expect(401);
    });
  });

  describe('CRUD', () => {
    let patientId: string;
    let guardianId: string;

    beforeAll(async () => {
      patientId = await createPatient(tokenA, yearsAgoDate(30));
    });

    it('crea un representante con el RUT normalizado y los defaults del esquema', async () => {
      const res = await postGuardian(tokenA, patientId, {
        fullName: '  María Soto  ',
        rut: '12.345.678-5',
        relationship: 'MOTHER',
        email: 'maria@example.com',
      }).expect(201);

      const body = res.body as Body;
      guardianId = body.id as string;
      expect(body).toEqual(
        expect.objectContaining({
          patientId,
          fullName: 'María Soto',
          rut: '12345678-5',
          relationship: 'MOTHER',
          email: 'maria@example.com',
          isPayer: false,
          receivesCommunications: true,
          canAccessReports: true,
          canConsent: true,
          custody: 'UNKNOWN',
          hasConflict: false,
        }),
      );
    });

    it('lista los representantes ordenados por creación', async () => {
      await postGuardian(
        tokenA,
        patientId,
        guardianBody({ relationship: 'FATHER', fullName: 'Pedro Rojas' }),
      ).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}/guardians`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const list = res.body as Body[];
      expect(list.map((g) => g.fullName)).toEqual([
        'María Soto',
        'Pedro Rojas',
      ]);
    });

    it('rechaza un tercer representante con 409', async () => {
      const res = await postGuardian(tokenA, patientId, guardianBody()).expect(
        409,
      );

      expect((res.body as Body).message).toContain('máximo 2');
    });

    it('edita un representante (PATCH parcial)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/patients/${patientId}/guardians/${guardianId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ custody: 'SHARED', hasConflict: true, phone: '+56911112222' })
        .expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({
          id: guardianId,
          custody: 'SHARED',
          hasConflict: true,
          phone: '+56911112222',
          fullName: 'María Soto',
        }),
      );
    });

    it('solo un representante puede ser pagador: marcar a otro desmarca al anterior', async () => {
      const [first, second] = (
        await request(app.getHttpServer())
          .get(`/api/v1/patients/${patientId}/guardians`)
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200)
      ).body as Body[];

      await request(app.getHttpServer())
        .patch(`/api/v1/patients/${patientId}/guardians/${first.id as string}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPayer: true })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/v1/patients/${patientId}/guardians/${second.id as string}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPayer: true })
        .expect(200);

      const payers = await prisma.legalGuardian.findMany({
        where: { patientId, isPayer: true },
      });
      expect(payers.map((g) => g.id)).toEqual([second.id]);
    });

    it('rechaza un RUT con dígito verificador inválido (400)', () => {
      return postGuardian(
        tokenA,
        patientId,
        guardianBody({ rut: '12345678-9' }),
      ).expect(400);
    });

    it('rechaza campos desconocidos como patientId en el cuerpo (400)', () => {
      return postGuardian(
        tokenA,
        patientId,
        guardianBody({ patientId: 'otro' }),
      ).expect(400);
    });

    it('elimina un representante sin consentimientos y libera el cupo', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/patients/${patientId}/guardians/${guardianId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(await prisma.legalGuardian.count({ where: { patientId } })).toBe(
        1,
      );
      await postGuardian(tokenA, patientId, guardianBody()).expect(201);
    });

    it('devuelve 404 al editar o eliminar un representante inexistente', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/patients/${patientId}/guardians/no-existe`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ canConsent: false })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/api/v1/patients/${patientId}/guardians/no-existe`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });
  });

  describe('aislamiento entre terapeutas', () => {
    let patientId: string;
    let guardianId: string;

    beforeAll(async () => {
      patientId = await createPatient(tokenA, yearsAgoDate(30));
      const res = await postGuardian(tokenA, patientId, guardianBody()).expect(
        201,
      );
      guardianId = (res.body as Body).id as string;
    });

    it('otro terapeuta recibe 404 en listar, crear, editar y eliminar', async () => {
      const base = `/api/v1/patients/${patientId}/guardians`;
      const auth = `Bearer ${tokenB}`;

      await request(app.getHttpServer())
        .get(base)
        .set('Authorization', auth)
        .expect(404);
      await postGuardian(tokenB, patientId, guardianBody()).expect(404);
      await request(app.getHttpServer())
        .patch(`${base}/${guardianId}`)
        .set('Authorization', auth)
        .send({ canConsent: false })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`${base}/${guardianId}`)
        .set('Authorization', auth)
        .expect(404);

      expect(await prisma.legalGuardian.count({ where: { patientId } })).toBe(
        1,
      );
    });

    it('un paciente dado de baja no admite representantes nuevos (404)', async () => {
      const deletedId = await createPatient(tokenA, yearsAgoDate(30));
      await request(app.getHttpServer())
        .delete(`/api/v1/patients/${deletedId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      await postGuardian(tokenA, deletedId, guardianBody()).expect(404);
    });
  });

  describe('eliminar con consentimiento referenciado', () => {
    it('devuelve 409 y conserva al representante', async () => {
      const patientId = await createPatient(tokenA, yearsAgoDate(10));
      const created = await postGuardian(
        tokenA,
        patientId,
        guardianBody(),
      ).expect(201);
      const guardianId = (created.body as Body).id as string;
      await prisma.patientConsent.create({
        data: {
          patientId,
          purpose: 'TREATMENT',
          action: 'GRANT',
          recordedById: therapistAId,
          evidence: 'Consentimiento firmado por la madre',
          grantedBy: 'GUARDIAN',
          guardianId,
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/patients/${patientId}/guardians/${guardianId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(409);

      expect((res.body as Body).message).toContain('consentimientos');
      expect(
        await prisma.legalGuardian.count({ where: { id: guardianId } }),
      ).toBe(1);
    });
  });

  describe('campos de edad y minorStatus', () => {
    it('un adulto es NOT_MINOR / ADULT y no expone la fecha de vigencia', async () => {
      const id = await createPatient(tokenA, yearsAgoDate(30));

      const body = await getPatient(tokenA, id);

      expect(body).toEqual(
        expect.objectContaining({
          isMinor: false,
          ageBand: 'ADULT',
          minorStatus: 'NOT_MINOR',
          guardianCount: 0,
          guardians: [],
        }),
      );
      expect(body).not.toHaveProperty('guardianEnforcementDate');
    });

    it('un menor sin representante es MISSING_GUARDIAN y trae la fecha de vigencia', async () => {
      const id = await createPatient(tokenA, yearsAgoDate(10));

      const body = await getPatient(tokenA, id);

      expect(body).toEqual(
        expect.objectContaining({
          isMinor: true,
          ageBand: 'UNDER_14',
          minorStatus: 'MISSING_GUARDIAN',
          guardianEnforcementDate: '2026-12-01',
        }),
      );
    });

    it('un representante sin canConsent no regulariza al menor', async () => {
      const id = await createPatient(tokenA, yearsAgoDate(16));
      await postGuardian(
        tokenA,
        id,
        guardianBody({ canConsent: false }),
      ).expect(201);

      const body = await getPatient(tokenA, id);

      expect(body).toEqual(
        expect.objectContaining({
          ageBand: 'AGE_14_17',
          minorStatus: 'MISSING_GUARDIAN',
          guardianCount: 1,
        }),
      );
    });

    it('con representante y sin consentimiento vigente es OK', async () => {
      const id = await createPatient(tokenA, yearsAgoDate(10));
      await postGuardian(tokenA, id, guardianBody()).expect(201);

      const body = await getPatient(tokenA, id);

      expect(body.minorStatus).toBe('OK');
      expect((body.guardians as Body[]).length).toBe(1);
    });

    it('con consentimiento legado es LEGACY_CONSENT y pasa a OK al registrar uno de representante', async () => {
      const id = await createPatient(tokenA, yearsAgoDate(10));
      const created = await postGuardian(tokenA, id, guardianBody()).expect(
        201,
      );
      const guardianId = (created.body as Body).id as string;

      // Legacy consent: seeded directly, since the API now requires a guardian
      // to grant consent for a minor. grantedBy defaults to PATIENT.
      await prisma.patientConsent.create({
        data: {
          patientId: id,
          purpose: 'TREATMENT',
          action: 'GRANT',
          recordedById: therapistAId,
          evidence: 'Consentimiento firmado antes del cambio',
        },
      });
      expect((await getPatient(tokenA, id)).minorStatus).toBe('LEGACY_CONSENT');

      // The list endpoint reports the same state without the guardians array.
      const list = await request(app.getHttpServer())
        .get('/api/v1/patients')
        .query({ search: (await getPatient(tokenA, id)).rut as string })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const row = ((list.body as Body).data as Body[])[0];
      expect(row).toEqual(
        expect.objectContaining({
          id,
          minorStatus: 'LEGACY_CONSENT',
          guardianCount: 1,
          isMinor: true,
        }),
      );
      expect(row).not.toHaveProperty('guardians');

      // Regularization: a newer grant by the guardian supersedes the legacy one.
      await prisma.patientConsent.create({
        data: {
          patientId: id,
          purpose: 'TREATMENT',
          action: 'GRANT',
          recordedById: therapistAId,
          evidence: 'Consentimiento firmado por la madre',
          grantedBy: 'GUARDIAN',
          guardianId,
        },
      });
      expect((await getPatient(tokenA, id)).minorStatus).toBe('OK');
    });
  });
});
