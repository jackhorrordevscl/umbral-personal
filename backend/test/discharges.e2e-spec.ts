import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { createHash } from 'crypto';
import * as patientDocumentStorage from '../src/common/utils/patient-document-storage.util';
import { chileDayKeyFromInstant } from '../src/common/utils/chile-time.util';
import { AppModule } from '../src/app.module';
import { DocumentEncryptionService } from '../src/modules/documents/document-encryption.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { uniqueTestRut } from './support/unique-rut';

// T3: el PDF del informe se guarda cifrado en B2, que el CI no tiene. Se
// reemplaza el storage por un Map en memoria, igual que documents.e2e-spec.ts
// (ver test/support/patient-document-storage.mock.ts).
jest.mock('../src/common/utils/patient-document-storage.util', () => {
  const mockModule = jest.requireActual<
    typeof import('./support/patient-document-storage.mock')
  >('./support/patient-document-storage.mock');
  return mockModule.createPatientDocumentStorageMock();
});

type Body = Record<string, unknown>;

/**
 * T2: informe de alta (borrador -> emisión con hash -> verificación ->
 * corrección versionada), aislamiento por terapeuta, consentimiento, reglas de
 * deserción (T2c) y mass assignment. Base real; fixtures por Prisma +
 * enrolamiento MFA, igual que patient-guardians.e2e-spec.ts.
 */
describe('Treatment discharges (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';
  const patientIds: string[] = [];

  let tokenA: string;
  let tokenB: string;
  let therapistAId: string;
  let therapistBId: string;

  async function createProfessionalAndLogin(
    email: string,
    name: string,
  ): Promise<{ id: string; token: string }> {
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        // El RUT del firmante es obligatorio para emitir un informe GENERATED.
        rut: uniqueTestRut(),
        professionalRegistration: `Reg. ${name}`,
      },
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

  async function createPatient(withConsent = true): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Discharge Test Patient',
        rut: uniqueTestRut(),
        birthDate: '1990-01-01',
      })
      .expect(201);
    const id = (res.body as Body).id as string;
    patientIds.push(id);
    if (withConsent) {
      await request(app.getHttpServer())
        .post(`/api/v1/patients/${id}/consents`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          purpose: 'TREATMENT',
          action: 'GRANT',
          evidence: 'Firma en papel escaneada',
        })
        .expect(201);
    }
    return id;
  }

  function daysFromNow(days: number): Date {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  async function seedConsultation(patientId: string, sessionDate: Date) {
    const patient = await prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
    });
    const id = `e2e-dis-${runId}-${Math.random().toString(36).slice(2, 10)}`;
    await prisma.consultation.create({
      data: {
        id,
        groupId: id,
        patientId,
        therapistId: therapistAId,
        sessionDate,
        durationMinutes: 50,
        consultReason: 'NOTA CLINICA PRIVADA',
        intervention: 'INTERVENCION PRIVADA',
        scheduledAt: sessionDate,
        patientRut: patient.rut,
      },
    });
  }

  const completeContent = {
    consultReason: 'Ansiedad generalizada',
    evolutionSummary: 'Evolución favorable durante el proceso',
    statusAtDischarge: 'Estable, sin síntomas relevantes',
    recommendations: 'Control a los tres meses',
  };

  function postDraft(token: string, patientId: string, body: Body) {
    return request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/discharges`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function patchDischarge(token: string, id: string, body: Body) {
    return request(app.getHttpServer())
      .patch(`/api/v1/discharges/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function post(token: string, path: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function get(token: string, path: string) {
    return request(app.getHttpServer())
      .get(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  // Crea un borrador completo listo para emitir.
  async function createReadyDraft(
    patientId: string,
    closure: Body = { closureReason: 'DISCHARGED' },
  ): Promise<string> {
    const draft = await postDraft(tokenA, patientId, closure).expect(201);
    const id = (draft.body as Body).id as string;
    await patchDischarge(tokenA, id, completeContent).expect(200);
    return id;
  }

  async function patientStatus(patientId: string): Promise<string> {
    const patient = await prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: { treatmentStatus: true },
    });
    return patient.treatmentStatus;
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
      `discharges.a.${runId}@umbral.cl`,
      'Discharges Therapist A',
    );
    therapistAId = a.id;
    tokenA = a.token;

    const b = await createProfessionalAndLogin(
      `discharges.b.${runId}@umbral.cl`,
      'Discharges Therapist B',
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
        await prisma.dischargeDelivery.deleteMany({
          where: { discharge: { patientId: { in: patientIds } } },
        });
        await prisma.treatmentDischarge.deleteMany({
          where: { patientId: { in: patientIds } },
        });
        // La FK TreatmentDischarge.documentId es Restrict: primero los informes.
        await prisma.patientDocument.deleteMany({
          where: { patientId: { in: patientIds } },
        });
        await prisma.patientConsent.deleteMany({
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
    it('rechaza sin token con 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/discharges/any-id')
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/patients/any-id/discharges')
        .send({ closureReason: 'DISCHARGED' })
        .expect(401);
    });
  });

  describe('flujo completo: borrador, emisión, verificación y corrección', () => {
    let patientId: string;
    let dischargeId: string;
    let correctionId: string;

    beforeAll(async () => {
      patientId = await createPatient();
      await seedConsultation(patientId, daysFromNow(-30));
      await seedConsultation(patientId, daysFromNow(-20));
      await seedConsultation(patientId, daysFromNow(-10));
      // Futura: no cuenta como sesión realizada.
      await seedConsultation(patientId, daysFromNow(5));
    });

    it('crea un borrador prellenado solo con recuento y fechas (sin notas clínicas)', async () => {
      const res = await postDraft(tokenA, patientId, {
        closureReason: 'DISCHARGED',
      }).expect(201);
      const body = res.body as Body;
      dischargeId = body.id as string;

      expect(body).toEqual(
        expect.objectContaining({
          patientId,
          therapistId: therapistAId,
          groupId: dischargeId,
          version: 1,
          status: 'DRAFT',
          source: 'GENERATED',
          closureReason: 'DISCHARGED',
          sessionCount: 3,
          consultReason: '',
          evolutionSummary: '',
          contentHash: null,
          issuedAt: null,
        }),
      );
      expect(JSON.stringify(body)).not.toContain('NOTA CLINICA PRIVADA');
      expect(JSON.stringify(body)).not.toContain('INTERVENCION PRIVADA');
      // El servicio calcula el día de admisión en hora de Chile; compararlo en
      // UTC fallaba cuando el CI corría entre 00:00 y 03:00 UTC.
      const firstConsultation = await prisma.consultation.findFirstOrThrow({
        where: { patientId },
        orderBy: { sessionDate: 'asc' },
      });
      expect(String(body.admissionDate)).toBe(
        `${chileDayKeyFromInstant(firstConsultation.sessionDate)}T00:00:00.000Z`,
      );
    });

    it('no admite un segundo borrador abierto (409)', async () => {
      await postDraft(tokenA, patientId, {
        closureReason: 'DISCHARGED',
      }).expect(409);
    });

    it('no permite emitir un borrador incompleto (400)', async () => {
      const res = await post(tokenA, `discharges/${dischargeId}/issue`).expect(
        400,
      );
      expect((res.body as Body).message).toContain('Completa antes de emitir');
    });

    it('edita el borrador', async () => {
      const res = await patchDischarge(tokenA, dischargeId, {
        ...completeContent,
        diagnosis: '  Trastorno de ansiedad  ',
      }).expect(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          ...completeContent,
          diagnosis: 'Trastorno de ansiedad',
          status: 'DRAFT',
        }),
      );
    });

    it('sin RUT en el perfil, emitir responde 400 accionable y no cierra nada', async () => {
      const original = await prisma.user.findUniqueOrThrow({
        where: { id: therapistAId },
        select: { rut: true },
      });
      await prisma.user.update({
        where: { id: therapistAId },
        data: { rut: null },
      });
      try {
        const res = await post(
          tokenA,
          `discharges/${dischargeId}/issue`,
        ).expect(400);
        expect((res.body as Body).message).toBe(
          'Completa tu RUT en tu perfil antes de emitir un informe de alta.',
        );
        expect(await patientStatus(patientId)).toBe('ACTIVE');
      } finally {
        await prisma.user.update({
          where: { id: therapistAId },
          data: { rut: original.rut },
        });
      }
    });

    it('emite: pasa a ISSUED con hash, firmante y cierra el tratamiento del paciente', async () => {
      const res = await post(tokenA, `discharges/${dischargeId}/issue`).expect(
        201,
      );
      const body = res.body as Body;
      expect(body.status).toBe('ISSUED');
      expect(body.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(body.issuedAt).toEqual(expect.any(String));
      expect(body.signerName).toBe('Discharges Therapist A');
      const therapist = await prisma.user.findUniqueOrThrow({
        where: { id: therapistAId },
        select: { rut: true, professionalRegistration: true },
      });
      expect(body.signerRut).toBe(therapist.rut);
      expect(body.signerProfessionalRegistration).toBe(
        'Reg. Discharges Therapist A',
      );
      expect(await patientStatus(patientId)).toBe('DISCHARGED');
    });

    it('audita DISCHARGE_ISSUE y TREATMENT_CLOSED sin fila genérica duplicada', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          userId: therapistAId,
          OR: [{ resourceId: dischargeId }, { resourceId: patientId }],
        },
      });
      const actions = logs.map((l) => l.action);
      expect(actions).toContain('DISCHARGE_ISSUE');
      expect(actions).toContain('TREATMENT_CLOSED');
      const closed = logs.find((l) => l.action === 'TREATMENT_CLOSED');
      expect(closed?.detail).toContain('status=DISCHARGED');
      expect(
        logs.some((l) => (l.detail ?? '').includes(`${dischargeId}/issue`)),
      ).toBe(false);
    });

    it('un informe emitido no se puede editar (409) ni emitir de nuevo (409)', async () => {
      await patchDischarge(tokenA, dischargeId, { sessionCount: 99 }).expect(
        409,
      );
      await post(tokenA, `discharges/${dischargeId}/issue`).expect(409);
    });

    it('verify devuelve valid=true sin exponer contenido clínico', async () => {
      const res = await get(tokenA, `discharges/${dischargeId}/verify`).expect(
        200,
      );
      const body = res.body as Body;
      expect(body).toEqual(
        expect.objectContaining({
          valid: true,
          dischargeId,
          version: 1,
          isCurrent: true,
        }),
      );
      expect(body).not.toHaveProperty('evolutionSummary');
      expect(body).not.toHaveProperty('recommendations');
    });

    it('verify detecta una alteración directa en la base', async () => {
      await prisma.treatmentDischarge.update({
        where: { id: dischargeId },
        data: { recommendations: 'Texto alterado fuera de la aplicación' },
      });
      const tampered = await get(
        tokenA,
        `discharges/${dischargeId}/verify`,
      ).expect(200);
      expect((tampered.body as Body).valid).toBe(false);

      await prisma.treatmentDischarge.update({
        where: { id: dischargeId },
        data: { recommendations: completeContent.recommendations },
      });
      const restored = await get(
        tokenA,
        `discharges/${dischargeId}/verify`,
      ).expect(200);
      expect((restored.body as Body).valid).toBe(true);
    });

    it('corrige: crea una versión DRAFT enlazada que hereda groupId', async () => {
      const res = await post(
        tokenA,
        `discharges/${dischargeId}/correct`,
      ).expect(201);
      const body = res.body as Body;
      correctionId = body.id as string;
      expect(body).toEqual(
        expect.objectContaining({
          status: 'DRAFT',
          version: 2,
          groupId: dischargeId,
          correctsId: dischargeId,
          contentHash: null,
          issuedAt: null,
          evolutionSummary: completeContent.evolutionSummary,
        }),
      );
      const log = await prisma.auditLog.findFirst({
        where: { action: 'DISCHARGE_CORRECT', resourceId: correctionId },
      });
      expect(log).not.toBeNull();
    });

    it('rechaza corregir de nuevo la misma versión (409) y corregir un borrador (409)', async () => {
      await post(tokenA, `discharges/${dischargeId}/correct`).expect(409);
      await post(tokenA, `discharges/${correctionId}/correct`).expect(409);
    });

    it('la versión original sigue verificándose pero ya no es la vigente', async () => {
      const res = await get(tokenA, `discharges/${dischargeId}/verify`).expect(
        200,
      );
      expect(res.body).toEqual(
        expect.objectContaining({ valid: true, isCurrent: false }),
      );
    });

    it('lista todas las versiones del paciente', async () => {
      const res = await get(tokenA, `patients/${patientId}/discharges`).expect(
        200,
      );
      const list = res.body as Body[];
      expect(list.map((d) => d.version)).toEqual([1, 2]);
    });

    it('verify de un borrador responde 409', async () => {
      await get(tokenA, `discharges/${correctionId}/verify`).expect(409);
    });

    it('GET /discharges/:id devuelve el informe del terapeuta dueño', async () => {
      const res = await get(tokenA, `discharges/${correctionId}`).expect(200);
      expect((res.body as Body).id).toBe(correctionId);
    });

    it('un paciente con tratamiento cerrado no admite un borrador nuevo (409)', async () => {
      await postDraft(tokenA, patientId, {
        closureReason: 'DISCHARGED',
      }).expect(409);
    });
  });

  describe('aislamiento entre terapeutas (IDOR)', () => {
    let patientId: string;
    let dischargeId: string;

    beforeAll(async () => {
      patientId = await createPatient();
      dischargeId = await createReadyDraft(patientId);
    });

    it('otro terapeuta recibe 404 (nunca 403) en todas las rutas', async () => {
      await postDraft(tokenB, patientId, {
        closureReason: 'DISCHARGED',
      }).expect(404);
      await get(tokenB, `patients/${patientId}/discharges`).expect(404);
      await get(tokenB, `discharges/${dischargeId}`).expect(404);
      await patchDischarge(tokenB, dischargeId, { sessionCount: 1 }).expect(
        404,
      );
      await post(tokenB, `discharges/${dischargeId}/issue`).expect(404);
      await post(tokenB, `discharges/${dischargeId}/correct`).expect(404);
      await get(tokenB, `discharges/${dischargeId}/verify`).expect(404);
    });

    it('el intento ajeno no altera el borrador', async () => {
      const row = await prisma.treatmentDischarge.findUniqueOrThrow({
        where: { id: dischargeId },
      });
      expect(row.status).toBe('DRAFT');
      expect(await patientStatus(patientId)).toBe('ACTIVE');
    });
  });

  describe('consentimiento', () => {
    it('emitir sin consentimiento TREATMENT vigente responde 403 y no cambia nada', async () => {
      const patientId = await createPatient(false);
      const id = await createReadyDraft(patientId);

      await post(tokenA, `discharges/${id}/issue`).expect(403);

      const row = await prisma.treatmentDischarge.findUniqueOrThrow({
        where: { id },
      });
      expect(row.status).toBe('DRAFT');
      expect(row.contentHash).toBeNull();
      expect(await patientStatus(patientId)).toBe('ACTIVE');
    });
  });

  describe('reglas de cierre (T2c)', () => {
    let patientId: string;

    beforeAll(async () => {
      patientId = await createPatient();
    });

    it('DROPPED_OUT sin dropoutReason responde 400', async () => {
      await postDraft(tokenA, patientId, {
        closureReason: 'DROPPED_OUT',
      }).expect(400);
    });

    it.each(['DISCHARGED', 'REFERRED'])(
      'dropoutReason con %s responde 400',
      async (closureReason) => {
        await postDraft(tokenA, patientId, {
          closureReason,
          dropoutReason: 'COST',
        }).expect(400);
      },
    );

    it('closureReason ACTIVE o fuera del enum responde 400', async () => {
      await postDraft(tokenA, patientId, { closureReason: 'ACTIVE' }).expect(
        400,
      );
      await postDraft(tokenA, patientId, { closureReason: 'NOPE' }).expect(400);
    });

    it('un dropoutReason fuera de la lista cerrada responde 400', async () => {
      await postDraft(tokenA, patientId, {
        closureReason: 'DROPPED_OUT',
        dropoutReason: 'INVENTED',
      }).expect(400);
    });

    it('dropoutNote solo con OTHER, máximo 200 y sin caracteres de control', async () => {
      await postDraft(tokenA, patientId, {
        closureReason: 'DROPPED_OUT',
        dropoutReason: 'COST',
        dropoutNote: 'nota',
      }).expect(400);
      await postDraft(tokenA, patientId, {
        closureReason: 'DROPPED_OUT',
        dropoutReason: 'OTHER',
        dropoutNote: 'a'.repeat(201),
      }).expect(400);
      await postDraft(tokenA, patientId, {
        closureReason: 'DROPPED_OUT',
        dropoutReason: 'OTHER',
        dropoutNote: 'con\u0000control',
      }).expect(400);
    });

    it('referralDestination solo con REFERRED y máximo 120', async () => {
      await postDraft(tokenA, patientId, {
        closureReason: 'DISCHARGED',
        referralDestination: 'CESFAM',
      }).expect(400);
      await postDraft(tokenA, patientId, {
        closureReason: 'REFERRED',
        referralDestination: 'a'.repeat(121),
      }).expect(400);
    });

    it('un PATCH no puede dejar el borrador incoherente', async () => {
      const draft = await postDraft(tokenA, patientId, {
        closureReason: 'DISCHARGED',
      }).expect(201);
      const id = (draft.body as Body).id as string;
      await patchDischarge(tokenA, id, { closureReason: 'DROPPED_OUT' }).expect(
        400,
      );
      await patchDischarge(tokenA, id, { dropoutReason: 'COST' }).expect(400);
      await patchDischarge(tokenA, id, {
        closureReason: 'DROPPED_OUT',
        dropoutReason: 'OTHER',
        dropoutNote: '  cambio de ciudad  ',
      })
        .expect(200)
        .expect((res) => {
          expect((res.body as Body).dropoutNote).toBe('cambio de ciudad');
        });
      // Volver a un alta exige limpiar los campos de deserción de forma explícita.
      await patchDischarge(tokenA, id, { closureReason: 'DISCHARGED' }).expect(
        400,
      );
      await patchDischarge(tokenA, id, {
        closureReason: 'DISCHARGED',
        dropoutReason: null,
        dropoutNote: null,
      }).expect(200);
    });

    it('emitir una deserción deja el estado DROPPED_OUT y el motivo en la auditoría', async () => {
      const dropPatient = await createPatient();
      const id = await createReadyDraft(dropPatient, {
        closureReason: 'DROPPED_OUT',
        dropoutReason: 'COST',
      });
      await post(tokenA, `discharges/${id}/issue`).expect(201);

      expect(await patientStatus(dropPatient)).toBe('DROPPED_OUT');
      const closed = await prisma.auditLog.findFirst({
        where: { action: 'TREATMENT_CLOSED', resourceId: dropPatient },
      });
      expect(closed?.detail).toContain('status=DROPPED_OUT');
      expect(closed?.detail).toContain('dropoutReason=COST');
    });

    it('emitir una derivación deja el estado REFERRED', async () => {
      const refPatient = await createPatient();
      const id = await createReadyDraft(refPatient, {
        closureReason: 'REFERRED',
        referralDestination: 'CESFAM Norte',
      });
      await post(tokenA, `discharges/${id}/issue`).expect(201);
      expect(await patientStatus(refPatient)).toBe('REFERRED');
    });
  });

  describe('cancelación de consultas futuras al cerrar (T2b)', () => {
    let patientId: string;
    let dischargeId: string;
    let otherPatientId: string; // paciente del terapeuta B
    const ids = {
      future1: '',
      future2: '',
      past: '',
      alreadyDeleted: '',
      oldVersion: '',
      newVersion: '',
      other: '',
    };
    let paymentGroupId: string;
    let paidGroupId: string;

    async function seed(
      forPatientId: string,
      therapistId: string,
      sessionDate: Date,
      extra: {
        groupId?: string;
        deletedAt?: Date | null;
        correctsId?: string;
        bookedSlot?: boolean;
      } = {},
    ): Promise<string> {
      const patient = await prisma.patient.findUniqueOrThrow({
        where: { id: forPatientId },
      });
      const id = `e2e-t2b-${runId}-${Math.random().toString(36).slice(2, 10)}`;
      const groupId = extra.groupId ?? id;
      await prisma.consultation.create({
        data: {
          id,
          groupId,
          patientId: forPatientId,
          therapistId,
          sessionDate,
          durationMinutes: 50,
          consultReason: 'NOTA CLINICA PRIVADA',
          intervention: 'INTERVENCION PRIVADA',
          scheduledAt: sessionDate,
          patientRut: patient.rut,
          deletedAt: extra.deletedAt ?? null,
          correctsId: extra.correctsId ?? null,
        },
      });
      if (extra.bookedSlot) {
        await prisma.bookedSlot.create({
          data: { therapistId, groupId, slotStart: sessionDate },
        });
      }
      return id;
    }

    const consultationRow = (id: string) =>
      prisma.consultation.findUniqueOrThrow({ where: { id } });

    beforeAll(async () => {
      patientId = await createPatient();
      const otherPatient = await prisma.patient.create({
        data: {
          fullName: 'Paciente Terapeuta B',
          rut: uniqueTestRut(),
          birthDate: new Date('1990-01-01T12:00:00.000Z'),
          therapistId: therapistBId,
        },
      });
      otherPatientId = otherPatient.id;
      patientIds.push(otherPatientId);

      // Horas distintas para no chocar con @@unique([therapistId, slotStart]).
      const base = (days: number, hour: number) => {
        const d = daysFromNow(days);
        d.setUTCHours(hour, 0, 0, 0);
        return d;
      };
      ids.future1 = await seed(patientId, therapistAId, base(20, 13), {
        bookedSlot: true,
      });
      ids.future2 = await seed(patientId, therapistAId, base(21, 14));
      ids.past = await seed(patientId, therapistAId, daysFromNow(-10));
      ids.alreadyDeleted = await seed(patientId, therapistAId, base(22, 15), {
        deletedAt: new Date(),
      });
      // Cadena corregida: la versión vieja (correctedBy != null) no se toca,
      // la nueva sí; ambas comparten groupId y por tanto el BookedSlot.
      ids.oldVersion = await seed(patientId, therapistAId, base(23, 16), {
        bookedSlot: true,
      });
      ids.newVersion = await seed(patientId, therapistAId, base(23, 17), {
        groupId: ids.oldVersion,
        correctsId: ids.oldVersion,
      });
      ids.other = await seed(otherPatientId, therapistBId, base(20, 13), {
        bookedSlot: true,
      });

      // Cobros: uno pendiente (se cancela) y uno pagado (se conserva).
      paymentGroupId = ids.future2;
      paidGroupId = ids.future1;
      await prisma.payment.create({
        data: {
          groupId: paymentGroupId,
          patientId,
          therapistId: therapistAId,
          amount: 30000,
          status: 'PENDING',
          dueDate: daysFromNow(21),
        },
      });
      await prisma.payment.create({
        data: {
          groupId: paidGroupId,
          patientId,
          therapistId: therapistAId,
          amount: 30000,
          status: 'PAID',
          paidAt: new Date(),
          dueDate: daysFromNow(20),
        },
      });

      dischargeId = await createReadyDraft(patientId, {
        closureReason: 'DROPPED_OUT',
        dropoutReason: 'COST',
      });
    });

    afterAll(async () => {
      await prisma.payment.deleteMany({ where: { patientId } });
      await prisma.bookedSlot.deleteMany({
        where: { therapistId: { in: [therapistAId, therapistBId] } },
      });
      // Las consultas de estos pacientes las borra el afterAll global.
    });

    it('al emitir cancela las futuras vigentes con cancelledByDischargeId y responde el conteo', async () => {
      const res = await post(tokenA, `discharges/${dischargeId}/issue`).expect(
        201,
      );
      expect((res.body as Body).cancelledConsultations).toBe(3);

      for (const id of [ids.future1, ids.future2, ids.newVersion]) {
        const row = await consultationRow(id);
        expect(row.cancelledByDischargeId).toBe(dischargeId);
        expect(row.cancelledAt).not.toBeNull();
        expect(row.deletedAt).not.toBeNull();
      }
      // El paciente NO se da de baja: sigue visible y con su RUT.
      const patient = await prisma.patient.findUniqueOrThrow({
        where: { id: patientId },
      });
      expect(patient.deletedAt).toBeNull();
      expect(patient.treatmentStatus).toBe('DROPPED_OUT');
    });

    it('no toca pasadas, ya borradas ni versiones corregidas', async () => {
      for (const id of [ids.past, ids.oldVersion]) {
        const row = await consultationRow(id);
        expect(row.cancelledAt).toBeNull();
        expect(row.cancelledByDischargeId).toBeNull();
        expect(row.deletedAt).toBeNull();
      }
      const deleted = await consultationRow(ids.alreadyDeleted);
      expect(deleted.cancelledAt).toBeNull();
      expect(deleted.cancelledByDischargeId).toBeNull();
    });

    it('libera los BookedSlot de las canceladas y respeta los de otro terapeuta', async () => {
      await expect(
        prisma.bookedSlot.findMany({
          where: {
            groupId: { in: [ids.future1, ids.future2, ids.oldVersion] },
          },
        }),
      ).resolves.toHaveLength(0);
      await expect(
        prisma.bookedSlot.findMany({ where: { groupId: ids.other } }),
      ).resolves.toHaveLength(1);
    });

    it('aislamiento: las consultas del terapeuta B no se tocan', async () => {
      const row = await consultationRow(ids.other);
      expect(row.cancelledAt).toBeNull();
      expect(row.deletedAt).toBeNull();
    });

    it('deja el cobro pendiente CANCELLED y conserva el pagado', async () => {
      const pending = await prisma.payment.findUniqueOrThrow({
        where: { groupId: paymentGroupId },
      });
      expect(pending.status).toBe('CANCELLED');
      const paid = await prisma.payment.findUniqueOrThrow({
        where: { groupId: paidGroupId },
      });
      expect(paid.status).toBe('PAID');
    });

    it('audita una fila CONSULTATION_CANCELLED por grupo, sin el motivo de deserción', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          userId: therapistAId,
          action: 'CONSULTATION_CANCELLED',
          resourceId: { in: [ids.future1, ids.future2, ids.oldVersion] },
        },
      });
      // future1, future2 y el grupo de la versión corregida (groupId = oldVersion).
      expect(logs).toHaveLength(3);
      for (const log of logs) {
        expect(log.resource).toBe('Consultation');
        expect(log.detail).toContain('status=DROPPED_OUT');
        expect(log.detail).toContain(`dischargeId=${dischargeId}`);
        expect(log.detail).not.toContain('COST');
      }
      const closed = await prisma.auditLog.findFirst({
        where: { action: 'TREATMENT_CLOSED', resourceId: patientId },
      });
      expect(closed?.detail).toContain('cancelledConsultations=3');
    });

    it('un cierre sin consultas futuras funciona sin error', async () => {
      const emptyPatient = await createPatient();
      const id = await createReadyDraft(emptyPatient);
      const res = await post(tokenA, `discharges/${id}/issue`).expect(201);
      expect((res.body as Body).cancelledConsultations).toBe(0);
    });
  });

  describe('mass assignment', () => {
    let patientId: string;

    beforeAll(async () => {
      patientId = await createPatient();
    });

    it.each([
      ['therapistId', 'otro'],
      ['status', 'ISSUED'],
      ['contentHash', 'a'.repeat(64)],
      ['issuedAt', '2026-01-01T00:00:00.000Z'],
      ['correctsId', 'x'],
      ['groupId', 'x'],
      ['signerName', 'Falso Firmante'],
      ['patientId', 'x'],
      ['version', 9],
    ])(
      'el borrador rechaza %s enviado por el cliente (400)',
      async (field, value) => {
        await postDraft(tokenA, patientId, {
          closureReason: 'DISCHARGED',
          [field]: value,
        }).expect(400);
      },
    );

    it('el PATCH rechaza campos protegidos y no los persiste', async () => {
      const draft = await postDraft(tokenA, patientId, {
        closureReason: 'DISCHARGED',
      }).expect(201);
      const id = (draft.body as Body).id as string;

      for (const [field, value] of [
        ['status', 'ISSUED'],
        ['contentHash', 'a'.repeat(64)],
        ['issuedAt', '2026-01-01T00:00:00.000Z'],
        ['signerRut', '1-9'],
        ['therapistId', therapistBId],
      ] as const) {
        await patchDischarge(tokenA, id, { [field]: value }).expect(400);
      }
      const row = await prisma.treatmentDischarge.findUniqueOrThrow({
        where: { id },
      });
      expect(row.status).toBe('DRAFT');
      expect(row.contentHash).toBeNull();
      expect(row.therapistId).toBe(therapistAId);
    });
  });

  describe('concurrencia', () => {
    it('dos emisiones simultáneas: una gana (201) y la otra recibe 409', async () => {
      const patientId = await createPatient();
      const id = await createReadyDraft(patientId);

      const results = await Promise.all([
        post(tokenA, `discharges/${id}/issue`),
        post(tokenA, `discharges/${id}/issue`),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const issued = await prisma.treatmentDischarge.count({
        where: { id, status: 'ISSUED' },
      });
      expect(issued).toBe(1);
    });

    it('dos correcciones simultáneas de la misma versión: una gana (201) y la otra 409', async () => {
      const patientId = await createPatient();
      const id = await createReadyDraft(patientId);
      await post(tokenA, `discharges/${id}/issue`).expect(201);

      const results = await Promise.all([
        post(tokenA, `discharges/${id}/correct`),
        post(tokenA, `discharges/${id}/correct`),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const corrections = await prisma.treatmentDischarge.count({
        where: { correctsId: id },
      });
      expect(corrections).toBe(1);
    });

    it('dos borradores simultáneos del mismo paciente: uno gana (201) y el otro recibe 409', async () => {
      const patientId = await createPatient();

      const results = await Promise.all([
        postDraft(tokenA, patientId, { closureReason: 'DISCHARGED' }),
        postDraft(tokenA, patientId, { closureReason: 'DISCHARGED' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const drafts = await prisma.treatmentDischarge.count({
        where: { patientId, status: 'DRAFT' },
      });
      expect(drafts).toBe(1);
    });
  });

  describe('estado del paciente al emitir y cadena de versiones', () => {
    it('emitir un informe nuevo con el paciente ya cerrado responde 409 y no cambia nada', async () => {
      const patientId = await createPatient();
      const id = await createReadyDraft(patientId);
      await seedConsultation(patientId, daysFromNow(7));
      await prisma.patient.update({
        where: { id: patientId },
        data: { treatmentStatus: 'REFERRED' },
      });

      await post(tokenA, `discharges/${id}/issue`).expect(409);

      expect(await patientStatus(patientId)).toBe('REFERRED');
      const row = await prisma.treatmentDischarge.findUniqueOrThrow({
        where: { id },
      });
      expect(row.status).toBe('DRAFT');
      const live = await prisma.consultation.count({
        where: { patientId, deletedAt: null },
      });
      expect(live).toBe(1);
    });

    it('una corrección emitida con el paciente reabierto queda como registro sin tocar su estado ni sus consultas', async () => {
      const patientId = await createPatient();
      const id = await createReadyDraft(patientId);
      await post(tokenA, `discharges/${id}/issue`).expect(201);
      const correction = await post(tokenA, `discharges/${id}/correct`).expect(
        201,
      );
      const correctionId = (correction.body as Body).id as string;

      // Reapertura (T5) y consulta nueva agendada después del cierre.
      await prisma.patient.update({
        where: { id: patientId },
        data: { treatmentStatus: 'ACTIVE' },
      });
      await seedConsultation(patientId, daysFromNow(9));

      const res = await post(tokenA, `discharges/${correctionId}/issue`).expect(
        201,
      );
      expect((res.body as Body).status).toBe('ISSUED');
      expect((res.body as Body).cancelledConsultations).toBe(0);
      expect(await patientStatus(patientId)).toBe('ACTIVE');
      const live = await prisma.consultation.count({
        where: { patientId, deletedAt: null, cancelledAt: null },
      });
      expect(live).toBe(1);
    });

    it('una corrección con otro motivo de cierre actualiza el estado del paciente cerrado', async () => {
      const patientId = await createPatient();
      const id = await createReadyDraft(patientId);
      await post(tokenA, `discharges/${id}/issue`).expect(201);
      expect(await patientStatus(patientId)).toBe('DISCHARGED');
      const correction = await post(tokenA, `discharges/${id}/correct`).expect(
        201,
      );
      const correctionId = (correction.body as Body).id as string;
      await patchDischarge(tokenA, correctionId, {
        closureReason: 'REFERRED',
        referralDestination: 'Hospital regional',
      }).expect(200);

      await post(tokenA, `discharges/${correctionId}/issue`).expect(201);
      expect(await patientStatus(patientId)).toBe('REFERRED');
    });

    it('verify cubre correctsId: reencadenar una versión en la base invalida el hash', async () => {
      const patientId = await createPatient();
      const id = await createReadyDraft(patientId);
      await post(tokenA, `discharges/${id}/issue`).expect(201);
      const correction = await post(tokenA, `discharges/${id}/correct`).expect(
        201,
      );
      const correctionId = (correction.body as Body).id as string;
      await post(tokenA, `discharges/${correctionId}/issue`).expect(201);

      const ok = await get(tokenA, `discharges/${correctionId}/verify`).expect(
        200,
      );
      expect((ok.body as Body).valid).toBe(true);

      await prisma.treatmentDischarge.update({
        where: { id: correctionId },
        data: { correctsId: null },
      });
      const tampered = await get(
        tokenA,
        `discharges/${correctionId}/verify`,
      ).expect(200);
      expect((tampered.body as Body).valid).toBe(false);

      await prisma.treatmentDischarge.update({
        where: { id: correctionId },
        data: { correctsId: id },
      });
      const restored = await get(
        tokenA,
        `discharges/${correctionId}/verify`,
      ).expect(200);
      expect((restored.body as Body).valid).toBe(true);
    });
  });

  describe('PDF del informe (T3)', () => {
    const storage = patientDocumentStorage as unknown as {
      writePatientDocumentBuffer: jest.Mock;
      readPatientDocumentBuffer: jest.Mock;
    };

    function sha256(buffer: Buffer): string {
      return createHash('sha256').update(buffer).digest('hex');
    }

    async function issueReady(): Promise<{
      patientId: string;
      id: string;
      body: Body;
    }> {
      const patientId = await createPatient();
      const id = await createReadyDraft(patientId);
      const res = await post(tokenA, `discharges/${id}/issue`).expect(201);
      return { patientId, id, body: res.body as Body };
    }

    function getPdf(token: string, id: string) {
      return request(app.getHttpServer())
        .get(`/api/v1/discharges/${id}/pdf`)
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
    }

    describe('emisión, descarga y verificación', () => {
      let patientId: string;
      let id: string;
      let issueBody: Body;

      beforeAll(async () => {
        ({ patientId, id, body: issueBody } = await issueReady());
      });

      it('al emitir guarda el PDF cifrado como DISCHARGE_REPORT y lo vincula', async () => {
        expect(issueBody.documentId).toEqual(expect.any(String));
        expect(issueBody.pdfSha256).toMatch(/^[0-9a-f]{64}$/);

        const doc = await prisma.patientDocument.findUniqueOrThrow({
          where: { id: issueBody.documentId as string },
        });
        expect(doc.type).toBe('DISCHARGE_REPORT');
        expect(doc.patientId).toBe(patientId);
        expect(doc.uploadedBy).toBe(therapistAId);
        expect(doc.storagePath).toMatch(/\.pdf\.enc$/);

        const raw = await patientDocumentStorage.readPatientDocumentBuffer(
          doc.storagePath,
        );
        // Cifrado con el llavero (cabecera 0x02), no PDF en claro.
        expect(raw.subarray(0, 4)).toEqual(
          Buffer.from([0x55, 0x4b, 0x02, 0x00]),
        );
        expect(raw.includes(Buffer.from('%PDF-'))).toBe(false);

        const row = await prisma.treatmentDischarge.findUniqueOrThrow({
          where: { id },
        });
        expect(row.documentId).toBe(doc.id);
      });

      it('GET /pdf devuelve el PDF descifrado con sus cabeceras', async () => {
        const res = await getPdf(tokenA, id).expect(200);
        const bytes = res.body as Buffer;

        expect(res.headers['content-type']).toContain('application/pdf');
        expect(res.headers['content-disposition']).toMatch(
          /^attachment; filename="informe-alta-v1-\d{4}-\d{2}-\d{2}\.pdf"$/,
        );
        expect(Number(res.headers['content-length'])).toBe(bytes.length);
        expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(sha256(bytes)).toBe(issueBody.pdfSha256);
      });

      it('verify informa pdf.intact=true sin exponer contenido', async () => {
        const res = await get(tokenA, `discharges/${id}/verify`).expect(200);
        const body = res.body as Body;
        expect(body.valid).toBe(true);
        expect(body.pdf).toEqual({ present: true, intact: true });
        expect(body).not.toHaveProperty('pdfSha256');
        expect(body).not.toHaveProperty('evolutionSummary');
      });

      it('verify detecta un PDF alterado en el storage y uno ausente', async () => {
        const doc = await prisma.patientDocument.findUniqueOrThrow({
          where: { id: issueBody.documentId as string },
        });
        const original = await patientDocumentStorage.readPatientDocumentBuffer(
          doc.storagePath,
        );
        const encryption = app.get(DocumentEncryptionService, {
          strict: false,
        });

        // Alterado: otro contenido, bien cifrado.
        await patientDocumentStorage.writePatientDocumentBuffer(
          doc.storagePath,
          encryption.encrypt(Buffer.from('%PDF-1.4 alterado')),
        );
        const tampered = await get(tokenA, `discharges/${id}/verify`).expect(
          200,
        );
        expect((tampered.body as Body).valid).toBe(true);
        expect((tampered.body as Body).pdf).toEqual({
          present: true,
          intact: false,
        });

        // Ausente.
        await patientDocumentStorage.deletePatientDocumentObject(
          doc.storagePath,
        );
        const missing = await get(tokenA, `discharges/${id}/verify`).expect(
          200,
        );
        expect((missing.body as Body).pdf).toEqual({
          present: true,
          intact: false,
        });

        await patientDocumentStorage.writePatientDocumentBuffer(
          doc.storagePath,
          original,
        );
        const restored = await get(tokenA, `discharges/${id}/verify`).expect(
          200,
        );
        expect((restored.body as Body).pdf).toEqual({
          present: true,
          intact: true,
        });
      });

      it('contentHash no incluye documentId ni pdfSha256: vincular el PDF no lo cambió', async () => {
        const row = await prisma.treatmentDischarge.findUniqueOrThrow({
          where: { id },
        });
        expect(row.contentHash).toBe(issueBody.contentHash);
      });

      it('otro terapeuta recibe 404 uniforme', async () => {
        await getPdf(tokenB, id).expect(404);
        await getPdf(tokenA, '00000000-0000-4000-8000-000000000000').expect(
          404,
        );
      });

      it('sin token da 401', async () => {
        await request(app.getHttpServer())
          .get(`/api/v1/discharges/${id}/pdf`)
          .expect(401);
      });

      it('audita la descarga con el paciente y la marca download', async () => {
        await getPdf(tokenA, id).expect(200);
        // El interceptor registra sin esperar la respuesta: se reintenta.
        let log: { detail: string | null } | null = null;
        for (let i = 0; i < 20 && !log; i++) {
          log = await prisma.auditLog.findFirst({
            where: {
              userId: therapistAId,
              action: 'VIEW',
              resource: 'Discharge',
              resourceId: id,
              detail: { contains: '/pdf' },
            },
          });
          if (!log) await new Promise((r) => setTimeout(r, 100));
        }
        expect(log).not.toBeNull();
        expect(log?.detail).toContain('download');
        expect(log?.detail).toContain(`patientId=${patientId}`);
      });

      it('el PDF no se puede anular por el endpoint genérico de documentos (409)', async () => {
        await request(app.getHttpServer())
          .post(`/api/v1/documents/${issueBody.documentId as string}/void`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ reason: 'Intento de anular el informe' })
          .expect(409);
      });

      it('el documento vinculado no se puede borrar de la base (FK Restrict)', async () => {
        await expect(
          prisma.patientDocument.delete({
            where: { id: issueBody.documentId as string },
          }),
        ).rejects.toThrow();
      });
    });

    it('un borrador da 409 en /pdf', async () => {
      const patientId = await createPatient();
      const id = await createReadyDraft(patientId);
      await getPdf(tokenA, id).expect(409);
    });

    it('si falla el storage al emitir, la emisión se completa y el primer GET /pdf lo genera', async () => {
      const patientId = await createPatient();
      const id = await createReadyDraft(patientId);
      storage.writePatientDocumentBuffer.mockRejectedValueOnce(
        new Error('B2 caído'),
      );

      const issued = await post(tokenA, `discharges/${id}/issue`).expect(201);
      const body = issued.body as Body;
      expect(body.status).toBe('ISSUED');
      expect(body.documentId).toBeNull();
      expect(await patientStatus(patientId)).toBe('DISCHARGED');
      expect(
        await prisma.patientDocument.count({
          where: { patientId, type: 'DISCHARGE_REPORT' },
        }),
      ).toBe(0);

      const res = await getPdf(tokenA, id).expect(200);
      expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe(
        '%PDF-',
      );
      const row = await prisma.treatmentDischarge.findUniqueOrThrow({
        where: { id },
      });
      expect(row.documentId).not.toBeNull();
      expect(row.pdfSha256).toBe(sha256(res.body as Buffer));
      // La verificación del contenido no se vio afectada.
      const verify = await get(tokenA, `discharges/${id}/verify`).expect(200);
      expect((verify.body as Body).valid).toBe(true);
    });

    it('dos GET /pdf concurrentes no dejan dos documentos vigentes', async () => {
      const patientId = await createPatient();
      const id = await createReadyDraft(patientId);
      storage.writePatientDocumentBuffer.mockRejectedValueOnce(
        new Error('B2 caído'),
      );
      await post(tokenA, `discharges/${id}/issue`).expect(201);

      const [a, b] = await Promise.all([
        getPdf(tokenA, id).expect(200),
        getPdf(tokenA, id).expect(200),
      ]);

      const docs = await prisma.patientDocument.findMany({
        where: { patientId, type: 'DISCHARGE_REPORT' },
      });
      expect(docs).toHaveLength(1);
      const row = await prisma.treatmentDischarge.findUniqueOrThrow({
        where: { id },
      });
      expect(row.documentId).toBe(docs[0].id);
      // Ambas respuestas sirven el documento ganador, no dos PDF distintos.
      expect(sha256(a.body as Buffer)).toBe(row.pdfSha256);
      expect(sha256(b.body as Buffer)).toBe(row.pdfSha256);
    });

    it('una corrección emitida genera su propio PDF, distinto del de la versión anterior', async () => {
      const { id } = await issueReady();
      const correction = await post(tokenA, `discharges/${id}/correct`).expect(
        201,
      );
      const correctionId = (correction.body as Body).id as string;
      const issued = await post(
        tokenA,
        `discharges/${correctionId}/issue`,
      ).expect(201);
      const body = issued.body as Body;
      expect(body.documentId).toEqual(expect.any(String));

      const original = await prisma.treatmentDischarge.findUniqueOrThrow({
        where: { id },
      });
      expect(body.documentId).not.toBe(original.documentId);
      const res = await getPdf(tokenA, correctionId).expect(200);
      expect(res.headers['content-disposition']).toContain('informe-alta-v2-');
    });
  });

  describe('entregas del informe (T4)', () => {
    async function issuedDischarge(): Promise<string> {
      const patientId = await createPatient();
      const id = await createReadyDraft(patientId);
      await post(tokenA, `discharges/${id}/issue`).expect(201);
      return id;
    }

    function postDelivery(token: string, id: string, body: Body) {
      return request(app.getHttpServer())
        .post(`/api/v1/discharges/${id}/deliveries`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    it('registra la entrega al paciente, la lista y deja una sola fila de auditoría explícita', async () => {
      const id = await issuedDischarge();

      const created = await postDelivery(tokenA, id, {
        recipientType: 'PATIENT',
        purpose: 'Entrega en la última sesión',
        channel: 'IN_PERSON',
      }).expect(201);
      expect(created.body).toMatchObject({
        dischargeId: id,
        recipientType: 'PATIENT',
        recipientName: 'Discharge Test Patient',
        recordedById: therapistAId,
      });

      const listed = await get(tokenA, `discharges/${id}/deliveries`).expect(
        200,
      );
      expect((listed.body as Body[]).map((d) => d.id)).toEqual([
        (created.body as Body).id,
      ]);

      const audits = await prisma.auditLog.findMany({
        where: { resourceId: id, action: 'DISCHARGE_DELIVER' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].detail).not.toContain('Discharge Test Patient');
    });

    it('un tercero sin autorización recibe 400 y no se registra nada', async () => {
      const id = await issuedDischarge();

      await postDelivery(tokenA, id, {
        recipientType: 'THIRD_PARTY',
        recipientName: 'Colegio Sur',
        purpose: 'Solicitud del colegio',
        channel: 'EMAIL',
      }).expect(400);

      const listed = await get(tokenA, `discharges/${id}/deliveries`).expect(
        200,
      );
      expect(listed.body).toEqual([]);
    });

    it('un borrador no se puede entregar (409)', async () => {
      const patientId = await createPatient();
      const draft = await createReadyDraft(patientId);

      await postDelivery(tokenA, draft, {
        recipientType: 'PATIENT',
        purpose: 'Prueba',
        channel: 'IN_PERSON',
      }).expect(409);
    });

    it('otro terapeuta recibe 404 al registrar y al listar', async () => {
      const id = await issuedDischarge();

      await postDelivery(tokenB, id, {
        recipientType: 'PATIENT',
        purpose: 'Prueba',
        channel: 'IN_PERSON',
      }).expect(404);
      await get(tokenB, `discharges/${id}/deliveries`).expect(404);
    });

    it('rechaza campos que el cliente no puede fijar (recordedById, deliveredAt)', async () => {
      const id = await issuedDischarge();

      await postDelivery(tokenA, id, {
        recipientType: 'PATIENT',
        purpose: 'Prueba',
        channel: 'IN_PERSON',
        recordedById: therapistBId,
        deliveredAt: '2020-01-01T00:00:00.000Z',
      }).expect(400);
    });
  });
});
