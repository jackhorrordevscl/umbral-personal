import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { uniqueTestRut } from './support/unique-rut';
import { chileDayKeyFromInstant } from '../src/common/utils/chile-time.util';
import { MINOR_GUARDIAN_ENFORCEMENT_DATE } from '../src/modules/patients/patients.constants';

// Same in-memory B2 stand-in as patient-consent.e2e-spec.ts.
jest.mock('../src/common/utils/patient-document-storage.util', () => {
  const mockModule = jest.requireActual<
    typeof import('./support/patient-document-storage.mock')
  >('./support/patient-document-storage.mock');
  return mockModule.createPatientDocumentStorageMock();
});

type Body = Record<string, unknown>;

/**
 * M2b: consentimiento y asentimiento de pacientes menores de edad.
 * - Escritura estricta: un GRANT de un menor exige un representante del mismo
 *   paciente con canConsent; un REVOKE se acepta siempre.
 * - Subir un documento de consentimiento de un menor exige guardianId (400
 *   ANTES de guardar el archivo); subir INFORMED_ASSENT registra asentimiento.
 * - Ledger de asentimiento append-only.
 * - Guardrail de consultas: la lectura sigue siendo suave hasta
 *   MINOR_GUARDIAN_ENFORCEMENT_DATE (2026-12-01). El comportamiento desde esa
 *   fecha no se simula acá (un reloj falso invalidaría los JWT de la sesión);
 *   lo cubre consultations.service.integration.spec.ts con Date falseado.
 */
describe('Minor consent and assent (e2e)', () => {
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
    birthDate: string,
    token = tokenA,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Minor Consent Test Patient',
        rut: uniqueTestRut(),
        birthDate,
      })
      .expect(201);
    const id = (res.body as Body).id as string;
    patientIds.push(id);
    return id;
  }

  async function createGuardian(
    patientId: string,
    overrides: Body = {},
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/guardians`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'María Soto',
        rut: uniqueTestRut(),
        relationship: 'MOTHER',
        ...overrides,
      })
      .expect(201);
    return (res.body as Body).id as string;
  }

  function postConsent(patientId: string, body: Body, token = tokenA) {
    return request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/consents`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        purpose: 'TREATMENT',
        evidence: 'Firmado en papel y escaneado al expediente',
        ...body,
      });
  }

  function upload(patientId: string, type: string, extra: Body = {}) {
    let req = request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('patientId', patientId)
      .field('type', type);
    for (const [key, value] of Object.entries(extra)) {
      req = req.field(key, value as string);
    }
    return req.attach('file', Buffer.from('%PDF-1.4\n%mock documento'), {
      filename: 'documento.pdf',
      contentType: 'application/pdf',
    });
  }

  function createConsultation(patientId: string) {
    return request(app.getHttpServer())
      .post('/api/v1/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        patientId,
        sessionDate: '2026-02-10',
        consultReason: 'Motivo',
        intervention: 'Intervención',
      });
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
      `minor.consent.a.${runId}@umbral.cl`,
      'Minor Consent Therapist A',
    );
    therapistAId = a.id;
    tokenA = a.token;

    const b = await createProfessionalAndLogin(
      `minor.consent.b.${runId}@umbral.cl`,
      'Minor Consent Therapist B',
    );
    therapistBId = b.id;
    tokenB = b.token;
  });

  afterAll(async () => {
    try {
      if (patientIds.length > 0) {
        await prisma.consultation.deleteMany({
          where: { patientId: { in: patientIds } },
        });
        // Ledgers reference documents and guardians (FK RESTRICT): they go first.
        await prisma.patientAssent.deleteMany({
          where: { patientId: { in: patientIds } },
        });
        await prisma.patientConsent.deleteMany({
          where: { patientId: { in: patientIds } },
        });
        await prisma.patientDocument.deleteMany({
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

  describe('POST /patients/:id/consents para un menor (escritura estricta)', () => {
    let minorId: string;

    beforeAll(async () => {
      minorId = await createPatient(yearsAgoDate(10));
    });

    it('un GRANT sin representante da 400 y no escribe en el ledger', async () => {
      const res = await postConsent(minorId, { action: 'GRANT' }).expect(400);

      expect(JSON.stringify(res.body)).toContain('representante legal');
      expect(
        await prisma.patientConsent.count({ where: { patientId: minorId } }),
      ).toBe(0);
    });

    it('un GRANT con grantedBy PATIENT da 400', async () => {
      await postConsent(minorId, {
        action: 'GRANT',
        grantedBy: 'PATIENT',
      }).expect(400);
    });

    it('un GRANT con un representante de otro paciente da 400', async () => {
      const otherMinor = await createPatient(yearsAgoDate(12));
      const foreignGuardian = await createGuardian(otherMinor);

      await postConsent(minorId, {
        action: 'GRANT',
        grantedBy: 'GUARDIAN',
        guardianId: foreignGuardian,
      }).expect(400);
    });

    it('un GRANT con un representante sin canConsent da 400', async () => {
      const guardianId = await createGuardian(minorId, { canConsent: false });

      await postConsent(minorId, {
        action: 'GRANT',
        grantedBy: 'GUARDIAN',
        guardianId,
      }).expect(400);
    });

    it('un GRANT con un representante habilitado se acepta y persiste grantedBy/guardianId', async () => {
      const guardianId = await createGuardian(minorId);

      const res = await postConsent(minorId, {
        action: 'GRANT',
        grantedBy: 'GUARDIAN',
        guardianId,
      }).expect(201);

      expect(res.body).toEqual(
        expect.objectContaining({ grantedBy: 'GUARDIAN', guardianId }),
      );
      const status = await request(app.getHttpServer())
        .get(`/api/v1/patients/${minorId}/consents/status`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(status.body).toEqual({ TREATMENT: true, TELEMEDICINE: false });
    });

    it('un REVOKE se acepta sin representante', async () => {
      const lonelyMinor = await createPatient(yearsAgoDate(9));

      await postConsent(lonelyMinor, {
        action: 'REVOKE',
        evidence: 'El representante pidió revocar el consentimiento',
      }).expect(201);
    });

    it('un terapeuta ajeno recibe 404', async () => {
      await postConsent(
        minorId,
        { action: 'REVOKE', evidence: 'Intento de un terapeuta ajeno' },
        tokenB,
      ).expect(404);
    });
  });

  describe('POST /patients/:id/consents para un adulto', () => {
    it('rechaza un guardianId o grantedBy GUARDIAN con 400', async () => {
      const adultId = await createPatient(yearsAgoDate(30));
      const minorId = await createPatient(yearsAgoDate(10));
      const guardianId = await createGuardian(minorId);

      await postConsent(adultId, {
        action: 'GRANT',
        grantedBy: 'GUARDIAN',
        guardianId,
      }).expect(400);
      await postConsent(adultId, { action: 'GRANT', guardianId }).expect(400);
    });

    it('sin otorgante sigue funcionando y queda como PATIENT', async () => {
      const adultId = await createPatient(yearsAgoDate(30));

      const res = await postConsent(adultId, { action: 'GRANT' }).expect(201);

      expect(res.body).toEqual(
        expect.objectContaining({ grantedBy: 'PATIENT', guardianId: null }),
      );
    });
  });

  describe('bulk-declare con menores', () => {
    it('omite al menor con la razón y declara al adulto', async () => {
      const minorId = await createPatient(yearsAgoDate(10));
      const adultId = await createPatient(yearsAgoDate(30));

      const res = await request(app.getHttpServer())
        .post('/api/v1/patients/consents/bulk-declare')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          patientIds: [minorId, adultId],
          purpose: 'TREATMENT',
          evidence: 'Consentimiento en papel del expediente físico previo',
        })
        .expect(201);

      expect(res.body).toEqual([
        {
          patientId: minorId,
          ok: false,
          error: expect.stringContaining('representante legal') as unknown,
        },
        { patientId: adultId, ok: true },
      ]);
    });
  });

  describe('POST /documents/upload de un menor', () => {
    it('INFORMED_CONSENT sin guardianId da 400 y no guarda el documento', async () => {
      const minorId = await createPatient(yearsAgoDate(10));

      await upload(minorId, 'INFORMED_CONSENT').expect(400);

      expect(
        await prisma.patientDocument.count({ where: { patientId: minorId } }),
      ).toBe(0);
      expect(
        await prisma.patientConsent.count({ where: { patientId: minorId } }),
      ).toBe(0);
    });

    it('INFORMED_CONSENT con guardianId otorga TREATMENT atribuido al representante', async () => {
      const minorId = await createPatient(yearsAgoDate(10));
      const guardianId = await createGuardian(minorId);

      await upload(minorId, 'INFORMED_CONSENT', { guardianId }).expect(201);

      const ledger = await prisma.patientConsent.findMany({
        where: { patientId: minorId },
      });
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toEqual(
        expect.objectContaining({
          action: 'GRANT',
          grantedBy: 'GUARDIAN',
          guardianId,
        }),
      );
    });

    it('INFORMED_CONSENT con el representante de otro paciente da 400 y no guarda el documento', async () => {
      const minorId = await createPatient(yearsAgoDate(10));
      const otherMinor = await createPatient(yearsAgoDate(11));
      const foreignGuardian = await createGuardian(otherMinor);

      await upload(minorId, 'INFORMED_CONSENT', {
        guardianId: foreignGuardian,
      }).expect(400);

      expect(
        await prisma.patientDocument.count({ where: { patientId: minorId } }),
      ).toBe(0);
    });

    it('anular el documento revoca el consentimiento conservando el representante', async () => {
      const minorId = await createPatient(yearsAgoDate(10));
      const guardianId = await createGuardian(minorId);
      const uploaded = await upload(minorId, 'INFORMED_CONSENT', {
        guardianId,
      }).expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/documents/${(uploaded.body as Body).id as string}/void`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'Documento equivocado' })
        .expect(201);

      const ledger = await prisma.patientConsent.findMany({
        where: { patientId: minorId },
        orderBy: { recordedAt: 'asc' },
      });
      expect(ledger.map((e) => e.action)).toEqual(['GRANT', 'REVOKE']);
      expect(ledger[1]).toEqual(
        expect.objectContaining({ grantedBy: 'GUARDIAN', guardianId }),
      );
    });

    it('INFORMED_ASSENT registra un asentimiento y nunca un consentimiento', async () => {
      const minorId = await createPatient(yearsAgoDate(16));

      const uploaded = await upload(minorId, 'INFORMED_ASSENT').expect(201);

      const assents = await prisma.patientAssent.findMany({
        where: { patientId: minorId },
      });
      expect(assents).toHaveLength(1);
      expect(assents[0]).toEqual(
        expect.objectContaining({
          action: 'GRANTED',
          ageBand: 'AGE_14_17',
          documentId: (uploaded.body as Body).id as string,
          recordedById: therapistAId,
        }),
      );
      expect(
        await prisma.patientConsent.count({ where: { patientId: minorId } }),
      ).toBe(0);
    });

    it('INFORMED_ASSENT de un adulto solo guarda el documento', async () => {
      const adultId = await createPatient(yearsAgoDate(30));

      await upload(adultId, 'INFORMED_ASSENT').expect(201);

      expect(
        await prisma.patientAssent.count({ where: { patientId: adultId } }),
      ).toBe(0);
    });
  });

  describe('/patients/:id/assents (append-only)', () => {
    let minorId: string;
    const assentsUrl = (id: string) => `/api/v1/patients/${id}/assents`;

    beforeAll(async () => {
      minorId = await createPatient(yearsAgoDate(10));
    });

    it('sin token devuelve 401', () => {
      return request(app.getHttpServer()).get(assentsUrl(minorId)).expect(401);
    });

    it('registra un evento con el tramo calculado en el servidor', async () => {
      const res = await request(app.getHttpServer())
        .post(assentsUrl(minorId))
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ action: 'INFORMED_AND_HEARD', note: 'Escuchado en sesión' })
        .expect(201);

      expect(res.body).toEqual(
        expect.objectContaining({
          patientId: minorId,
          action: 'INFORMED_AND_HEARD',
          ageBand: 'UNDER_14',
          note: 'Escuchado en sesión',
          recordedById: therapistAId,
        }),
      );
    });

    it('rechaza un ageBand enviado por el cliente (400)', async () => {
      await request(app.getHttpServer())
        .post(assentsUrl(minorId))
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ action: 'GRANTED', ageBand: 'AGE_14_17' })
        .expect(400);
    });

    it('rechaza una nota de más de 500 caracteres (400)', async () => {
      await request(app.getHttpServer())
        .post(assentsUrl(minorId))
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ action: 'GRANTED', note: 'x'.repeat(501) })
        .expect(400);
    });

    it('rechaza un documento inexistente o de otro paciente (400)', async () => {
      const otherMinor = await createPatient(yearsAgoDate(16));
      const doc = await upload(otherMinor, 'INFORMED_ASSENT').expect(201);

      await request(app.getHttpServer())
        .post(assentsUrl(minorId))
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ action: 'GRANTED', documentId: (doc.body as Body).id })
        .expect(400);
    });

    it('rechaza un documento del mismo paciente que no es un asentimiento (400)', async () => {
      const doc = await upload(minorId, 'SESSION_SUMMARY').expect(201);

      await request(app.getHttpServer())
        .post(assentsUrl(minorId))
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ action: 'GRANTED', documentId: (doc.body as Body).id })
        .expect(400);
    });

    it('rechaza un documento anulado del mismo paciente (400)', async () => {
      const doc = await upload(minorId, 'INFORMED_ASSENT').expect(201);
      const docId = (doc.body as Body).id as string;
      await request(app.getHttpServer())
        .post(`/api/v1/documents/${docId}/void`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'Documento equivocado' })
        .expect(201);

      await request(app.getHttpServer())
        .post(assentsUrl(minorId))
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ action: 'GRANTED', documentId: docId })
        .expect(400);
    });

    it('un adulto recibe 400', async () => {
      const adultId = await createPatient(yearsAgoDate(30));

      await request(app.getHttpServer())
        .post(assentsUrl(adultId))
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ action: 'GRANTED' })
        .expect(400);
    });

    it('un terapeuta ajeno recibe 404 al listar y al registrar', async () => {
      await request(app.getHttpServer())
        .get(assentsUrl(minorId))
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      await request(app.getHttpServer())
        .post(assentsUrl(minorId))
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ action: 'GRANTED' })
        .expect(404);
    });

    it('lista el ledger de más reciente a más antiguo', async () => {
      await request(app.getHttpServer())
        .post(assentsUrl(minorId))
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ action: 'WITHDRAWN' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(assentsUrl(minorId))
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const actions = (res.body as Body[]).map((e) => e.action);
      expect(actions[0]).toBe('WITHDRAWN');
      expect(actions).toContain('INFORMED_AND_HEARD');
    });

    it('no existen PATCH ni DELETE (404)', async () => {
      const list = await request(app.getHttpServer())
        .get(assentsUrl(minorId))
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const assentId = (list.body as Body[])[0].id as string;

      await request(app.getHttpServer())
        .patch(`${assentsUrl(minorId)}/${assentId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ action: 'REFUSED' })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`${assentsUrl(minorId)}/${assentId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });
  });

  // Antes de MINOR_GUARDIAN_ENFORCEMENT_DATE el consentimiento legado del
  // paciente sigue valiendo (lectura suave). El reloj no se puede falsear en
  // e2e (invalidaría los JWT), así que estos casos solo corren mientras la
  // fecha real sea anterior a la de vigencia; la cobertura de ambos lados de
  // la fecha vive en consultations.service.integration.spec.ts con Date
  // falseado.
  const beforeEnforcement =
    chileDayKeyFromInstant(new Date()) < MINOR_GUARDIAN_ENFORCEMENT_DATE;
  (beforeEnforcement ? describe : describe.skip)(
    'guardrail de consultas para un menor (antes de la fecha de vigencia)',
    () => {
      it('un menor sin consentimiento recibe 403', async () => {
        const minorId = await createPatient(yearsAgoDate(10));

        await createConsultation(minorId).expect(403);
      });

      it('un menor con consentimiento legado del paciente puede tener consultas', async () => {
        const minorId = await createPatient(yearsAgoDate(10));
        await prisma.patientConsent.create({
          data: {
            patientId: minorId,
            purpose: 'TREATMENT',
            action: 'GRANT',
            recordedById: therapistAId,
            evidence: 'Consentimiento legado anterior al cambio (fixture)',
          },
        });

        await createConsultation(minorId).expect(201);
      });

      it('un menor con consentimiento del representante puede tener consultas', async () => {
        const minorId = await createPatient(yearsAgoDate(10));
        const guardianId = await createGuardian(minorId);
        await postConsent(minorId, {
          action: 'GRANT',
          grantedBy: 'GUARDIAN',
          guardianId,
        }).expect(201);

        await createConsultation(minorId).expect(201);
      });

      it('un adulto con consentimiento no cambia', async () => {
        const adultId = await createPatient(yearsAgoDate(30));
        await postConsent(adultId, { action: 'GRANT' }).expect(201);

        await createConsultation(adultId).expect(201);
      });
    },
  );
});
