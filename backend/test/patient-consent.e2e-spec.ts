import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Issue #158 (fix CI post-migración a B2): ver
// test/support/patient-document-storage.mock.ts -- reemplaza el S3Client
// real por un Map en memoria para que POST /documents/upload no dependa de
// red externa a Backblaze B2.
jest.mock('../src/common/utils/patient-document-storage.util', () => {
  const mockModule = jest.requireActual<
    typeof import('./support/patient-document-storage.mock')
  >('./support/patient-document-storage.mock');
  return mockModule.createPatientDocumentStorageMock();
});

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

  // Issue #131 (T6): pacientes propios de cada bloque nuevo, para no
  // interferir con la secuencia de eventos que ya arma la suite original
  // sobre `patientId`.
  let guardrailPatientId: string;
  let uploadPatientId: string;
  let bulkPatientAId1: string;
  let bulkPatientAId2: string;
  let bulkPatientBId: string;

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

      const extraPatientIds = [
        guardrailPatientId,
        uploadPatientId,
        bulkPatientAId1,
        bulkPatientAId2,
        bulkPatientBId,
      ].filter((id): id is string => Boolean(id));
      if (extraPatientIds.length > 0) {
        await prisma.consultation.deleteMany({
          where: { patientId: { in: extraPatientIds } },
        });
        await prisma.patientDocument.deleteMany({
          where: { patientId: { in: extraPatientIds } },
        });
        await prisma.patientConsent.deleteMany({
          where: { patientId: { in: extraPatientIds } },
        });
        await prisma.patient.deleteMany({
          where: { id: { in: extraPatientIds } },
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

  // Issue #131 (T6): el guardrail real -- sin consentimiento vigente, ni
  // create() ni correct() de una Consultation deben pasar.
  describe('Guardrail de consentimiento en Consultation (issue #131)', () => {
    let consultationId: string;

    beforeAll(async () => {
      const patientCreate = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          fullName: 'Guardrail Test Patient',
          rut: `GUARDRAIL${runId}`,
          birthDate: '1990-01-01',
        })
        .expect(201);
      guardrailPatientId = (patientCreate.body as Record<string, unknown>)
        .id as string;
    });

    it('POST /consultations sin consentimiento vigente devuelve 403', () => {
      return request(app.getHttpServer())
        .post('/api/v1/consultations')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          patientId: guardrailPatientId,
          sessionDate: '2026-02-10',
          consultReason: 'Motivo',
          intervention: 'Intervención',
        })
        .expect(403);
    });

    it('otorgado el consentimiento, POST /consultations crea la sesión (2xx)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/patients/${guardrailPatientId}/consents`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          purpose: 'TREATMENT',
          action: 'GRANT',
          evidence: 'Firma en papel durante la primera sesión presencial',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/v1/consultations')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          patientId: guardrailPatientId,
          sessionDate: '2026-02-10',
          consultReason: 'Motivo',
          intervention: 'Intervención',
        })
        .expect(201);
      consultationId = (res.body as Record<string, unknown>).id as string;
    });

    it('revocado el consentimiento, PATCH .../correct devuelve 403', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/patients/${guardrailPatientId}/consents`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          purpose: 'TREATMENT',
          action: 'REVOKE',
          evidence: 'Paciente solicitó revocar consentimiento de tratamiento',
        })
        .expect(201);

      return request(app.getHttpServer())
        .patch(`/api/v1/consultations/${consultationId}/correct`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({ consultReason: 'Motivo corregido' })
        .expect(403);
    });
  });

  // Issue #131 (T1): subir un documento de tipo consentimiento debe generar
  // el evento en el ledger automáticamente, sin un segundo paso manual.
  describe('Upload de documento dispara consentimiento automático (issue #131)', () => {
    beforeAll(async () => {
      const patientCreate = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          fullName: 'Upload Consent Test Patient',
          rut: `UPLOADCONSENT${runId}`,
          birthDate: '1990-01-01',
        })
        .expect(201);
      uploadPatientId = (patientCreate.body as Record<string, unknown>)
        .id as string;
    });

    it('subir INFORMED_CONSENT otorga TREATMENT automáticamente en el ledger', async () => {
      const fakePdf = Buffer.from('%PDF-1.4\n%mock consentimiento firmado');

      await request(app.getHttpServer())
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .field('patientId', uploadPatientId)
        .field('type', 'INFORMED_CONSENT')
        .attach('file', fakePdf, {
          filename: 'consentimiento.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/patients/${uploadPatientId}/consents/status`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);
      expect(res.body).toEqual({ TREATMENT: true, TELEMEDICINE: false });

      const ledger = await prisma.patientConsent.findMany({
        where: { patientId: uploadPatientId },
      });
      expect(ledger.length).toBe(1);
      expect(ledger[0].evidence).toContain('consentimiento.pdf');
    });

    it('subir INFORMED_ASSENT NO otorga consentimiento automático (Art. 25, el asentimiento del menor no reemplaza al del tutor)', async () => {
      const fakePdf = Buffer.from('%PDF-1.4\n%mock asentimiento del menor');

      await request(app.getHttpServer())
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .field('patientId', uploadPatientId)
        .field('type', 'INFORMED_ASSENT')
        .attach('file', fakePdf, {
          filename: 'asentimiento.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);

      // El ledger sigue teniendo solo el evento del test anterior -- ninguno
      // nuevo se generó por este upload.
      const ledger = await prisma.patientConsent.findMany({
        where: { patientId: uploadPatientId },
      });
      expect(ledger.length).toBe(1);
    });
  });

  // Issue #131 (T5): declaración retroactiva en bloque.
  describe('POST /patients/consents/bulk-declare (issue #131 T5)', () => {
    beforeAll(async () => {
      const p1 = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          fullName: 'Bulk Patient A1',
          rut: `BULKA1${runId}`,
          birthDate: '1990-01-01',
        })
        .expect(201);
      bulkPatientAId1 = (p1.body as Record<string, unknown>).id as string;

      const p2 = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          fullName: 'Bulk Patient A2',
          rut: `BULKA2${runId}`,
          birthDate: '1990-01-01',
        })
        .expect(201);
      bulkPatientAId2 = (p2.body as Record<string, unknown>).id as string;

      const p3 = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .send({
          fullName: 'Bulk Patient B (ajeno)',
          rut: `BULKB${runId}`,
          birthDate: '1990-01-01',
        })
        .expect(201);
      bulkPatientBId = (p3.body as Record<string, unknown>).id as string;
    });

    it('declara consentimiento para los propios y reporta el ajeno sin abortar el lote', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/patients/consents/bulk-declare')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          patientIds: [bulkPatientAId1, bulkPatientAId2, bulkPatientBId],
          purpose: 'TREATMENT',
          evidence: 'Consentimiento en papel del expediente físico previo',
        })
        .expect(201);

      expect(res.body).toEqual([
        { patientId: bulkPatientAId1, ok: true },
        { patientId: bulkPatientAId2, ok: true },
        {
          patientId: bulkPatientBId,
          ok: false,
          error: 'Paciente no encontrado',
        },
      ]);

      const statusA1 = await request(app.getHttpServer())
        .get(`/api/v1/patients/${bulkPatientAId1}/consents/status`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);
      expect(statusA1.body).toEqual({ TREATMENT: true, TELEMEDICINE: false });

      const ledgerB = await prisma.patientConsent.findMany({
        where: { patientId: bulkPatientBId },
      });
      expect(ledgerB.length).toBe(0);
    });

    it('rechaza evidence menor a 10 caracteres (400)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/patients/consents/bulk-declare')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({
          patientIds: [bulkPatientAId1],
          purpose: 'TREATMENT',
          evidence: 'corta',
        })
        .expect(400);
    });
  });
});
