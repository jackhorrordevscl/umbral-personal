import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { createHash } from 'crypto';
import * as patientDocumentStorage from '../src/common/utils/patient-document-storage.util';
import { AppModule } from '../src/app.module';
import { DocumentEncryptionService } from '../src/modules/documents/document-encryption.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { uniqueTestRut } from './support/unique-rut';

// B2 no existe en CI: el storage se reemplaza por un Map en memoria.
jest.mock('../src/common/utils/patient-document-storage.util', () => {
  const mockModule = jest.requireActual<
    typeof import('./support/patient-document-storage.mock')
  >('./support/patient-document-storage.mock');
  return mockModule.createPatientDocumentStorageMock();
});

type Body = Record<string, unknown>;

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function pdfBytes(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`, 'latin1');
}

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

/**
 * T3b: el terapeuta sube su propio PDF como informe de alta. Base real, B2
 * mockeado. Cubre validación del archivo, cierre del tratamiento, aislamiento,
 * concurrencia, reemplazo versionado y verify de un documento aportado.
 */
describe('Treatment discharges: PDF propio (e2e)', () => {
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
    // Sin RUT a propósito: subir un PDF propio no lo exige.
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

  async function createPatient(withConsent = true): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Upload Test Patient',
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

  async function seedFutureConsultation(patientId: string) {
    const patient = await prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
    });
    const id = `e2e-up-${runId}-${Math.random().toString(36).slice(2, 10)}`;
    const sessionDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await prisma.consultation.create({
      data: {
        id,
        groupId: id,
        patientId,
        therapistId: therapistAId,
        sessionDate,
        durationMinutes: 50,
        consultReason: 'NOTA PRIVADA',
        intervention: 'INTERVENCION PRIVADA',
        scheduledAt: sessionDate,
        patientRut: patient.rut,
      },
    });
    return id;
  }

  function upload(
    token: string,
    patientId: string,
    opts: {
      fields?: Record<string, string>;
      file?: { buffer: Buffer; filename: string; contentType: string } | null;
    } = {},
  ) {
    const req = request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/discharges/upload`)
      .set('Authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(
      opts.fields ?? { closureReason: 'DISCHARGED' },
    )) {
      req.field(k, v);
    }
    const file =
      opts.file === undefined
        ? {
            buffer: pdfBytes('v1'),
            filename: 'epicrisis.pdf',
            contentType: 'application/pdf',
          }
        : opts.file;
    if (file) {
      req.attach('file', file.buffer, {
        filename: file.filename,
        contentType: file.contentType,
      });
    }
    return req;
  }

  function correctUpload(
    token: string,
    id: string,
    buffer: Buffer,
    fields: Record<string, string> = { closureReason: 'DISCHARGED' },
  ) {
    const req = request(app.getHttpServer())
      .post(`/api/v1/discharges/${id}/correct-upload`)
      .set('Authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    return req.attach('file', buffer, {
      filename: 'epicrisis-v2.pdf',
      contentType: 'application/pdf',
    });
  }

  function get(token: string, path: string) {
    return request(app.getHttpServer())
      .get(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function getPdf(token: string, id: string) {
    return get(token, `discharges/${id}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  }

  async function patientStatus(patientId: string): Promise<string> {
    const patient = await prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: { treatmentStatus: true },
    });
    return patient.treatmentStatus;
  }

  async function reportDocs(patientId: string) {
    return prisma.patientDocument.findMany({
      where: { patientId, type: 'DISCHARGE_REPORT' },
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
      `dis-upload.a.${runId}@umbral.cl`,
      'Upload Therapist A',
    );
    therapistAId = a.id;
    tokenA = a.token;
    const b = await createProfessionalAndLogin(
      `dis-upload.b.${runId}@umbral.cl`,
      'Upload Therapist B',
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
        await prisma.treatmentDischarge.deleteMany({
          where: { patientId: { in: patientIds } },
        });
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

  it('rechaza sin token con 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/patients/any/discharges/upload')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/discharges/any/correct-upload')
      .expect(401);
  });

  describe('subida válida', () => {
    let patientId: string;
    let futureConsultationId: string;
    let body: Body;
    const bytes = pdfBytes('original');

    beforeAll(async () => {
      patientId = await createPatient();
      futureConsultationId = await seedFutureConsultation(patientId);
      const res = await upload(tokenA, patientId, {
        fields: { closureReason: 'DISCHARGED' },
        file: {
          buffer: bytes,
          filename: '../../mi epicrisis.pdf',
          contentType: 'application/pdf',
        },
      }).expect(201);
      body = res.body as Body;
    });

    it('emite directo como UPLOADED, con hash de los bytes, sin contenido clínico y sin RUT', () => {
      expect(body).toMatchObject({
        source: 'UPLOADED',
        status: 'ISSUED',
        version: 1,
        closureReason: 'DISCHARGED',
        contentHash: sha256(bytes),
        pdfSha256: sha256(bytes),
        consultReason: '',
        evolutionSummary: '',
        recommendations: '',
        signerName: 'Upload Therapist A',
        signerRut: null,
        cancelledConsultations: 1,
      });
      expect(body.documentId).toEqual(expect.any(String));
    });

    it('cierra el tratamiento y cancela las consultas futuras', async () => {
      expect(await patientStatus(patientId)).toBe('DISCHARGED');
      const consultation = await prisma.consultation.findUniqueOrThrow({
        where: { id: futureConsultationId },
      });
      expect(consultation.cancelledAt).not.toBeNull();
      expect(consultation.cancelledByDischargeId).toBe(body.id);
    });

    it('guarda el PDF cifrado con nombre saneado, sin PDF en claro en el storage', async () => {
      const docs = await reportDocs(patientId);
      expect(docs).toHaveLength(1);
      expect(docs[0].id).toBe(body.documentId);
      expect(docs[0].fileName).toBe('mi epicrisis.pdf');
      const raw = await patientDocumentStorage.readPatientDocumentBuffer(
        docs[0].storagePath,
      );
      expect(raw.includes(Buffer.from('%PDF-'))).toBe(false);
    });

    it('GET /pdf devuelve los mismos bytes subidos, con cabeceras seguras', async () => {
      const res = await getPdf(tokenA, body.id as string).expect(200);
      expect((res.body as Buffer).equals(bytes)).toBe(true);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="mi epicrisis.pdf"; filename*=UTF-8''mi%20epicrisis.pdf`,
      );
    });

    it('verify es válido y se marca como documento aportado por el terapeuta', async () => {
      const res = await get(
        tokenA,
        `discharges/${body.id as string}/verify`,
      ).expect(200);
      expect(res.body).toMatchObject({
        valid: true,
        source: 'UPLOADED',
        providedByTherapist: true,
        hashScope: 'FILE_ONLY',
        isCurrent: true,
        contentHash: sha256(bytes),
        pdf: { present: true, intact: true },
      });
    });

    it('verify detecta que los bytes guardados fueron alterados', async () => {
      const doc = await prisma.patientDocument.findUniqueOrThrow({
        where: { id: body.documentId as string },
      });
      const original = await patientDocumentStorage.readPatientDocumentBuffer(
        doc.storagePath,
      );
      const encryption = app.get(DocumentEncryptionService, { strict: false });
      await patientDocumentStorage.writePatientDocumentBuffer(
        doc.storagePath,
        encryption.encrypt(pdfBytes('alterado')),
      );
      const res = await get(
        tokenA,
        `discharges/${body.id as string}/verify`,
      ).expect(200);
      expect((res.body as Body).valid).toBe(false);
      expect((res.body as Body).pdf).toEqual({ present: true, intact: false });
      await patientDocumentStorage.writePatientDocumentBuffer(
        doc.storagePath,
        original,
      );
    });

    it('audita DISCHARGE_ISSUE (source=UPLOADED), TREATMENT_CLOSED y CONSULTATION_CANCELLED', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          userId: therapistAId,
          OR: [
            { resourceId: body.id as string },
            { resourceId: patientId },
            { resourceId: futureConsultationId },
          ],
        },
      });
      const actions = logs.map((l) => l.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'DISCHARGE_ISSUE',
          'TREATMENT_CLOSED',
          'CONSULTATION_CANCELLED',
        ]),
      );
      const issue = logs.find((l) => l.action === 'DISCHARGE_ISSUE');
      expect(issue?.detail).toContain('source=UPLOADED');
      expect(issue?.detail).not.toContain('epicrisis');
    });

    it('otro terapeuta recibe 404 uniforme en pdf, verify y correct-upload', async () => {
      await getPdf(tokenB, body.id as string).expect(404);
      await get(tokenB, `discharges/${body.id as string}/verify`).expect(404);
      await correctUpload(tokenB, body.id as string, pdfBytes('x')).expect(404);
    });

    it('otro terapeuta no puede subir un informe a un paciente ajeno (404)', async () => {
      const other = await createPatient();
      await upload(tokenB, other).expect(404);
      expect(await patientStatus(other)).toBe('ACTIVE');
      expect(await reportDocs(other)).toHaveLength(0);
    });

    it('un segundo informe para el paciente ya cerrado da 409 y no deja documento huérfano', async () => {
      await upload(tokenA, patientId).expect(409);
      expect(await reportDocs(patientId)).toHaveLength(1);
    });
  });

  describe('validación del archivo', () => {
    let patientId: string;

    beforeAll(async () => {
      patientId = await createPatient();
    });

    async function expectRejected(res: request.Test, status = 400) {
      await res.expect(status);
      expect(await patientStatus(patientId)).toBe('ACTIVE');
      expect(await reportDocs(patientId)).toHaveLength(0);
      expect(
        await prisma.treatmentDischarge.count({ where: { patientId } }),
      ).toBe(0);
    }

    it('sin archivo da 400', async () => {
      await expectRejected(upload(tokenA, patientId, { file: null }));
    });

    it('un ejecutable con mime application/pdf da 400', async () => {
      await expectRejected(
        upload(tokenA, patientId, {
          file: {
            buffer: EXE_BYTES,
            filename: 'virus.pdf',
            contentType: 'application/pdf',
          },
        }),
      );
    });

    it('un .exe con extensión .exe y mime application/pdf da 400', async () => {
      await expectRejected(
        upload(tokenA, patientId, {
          file: {
            buffer: EXE_BYTES,
            filename: 'virus.exe',
            contentType: 'application/pdf',
          },
        }),
      );
    });

    it('un PNG renombrado a .pdf (con mime pdf o con mime png) da 400', async () => {
      await expectRejected(
        upload(tokenA, patientId, {
          file: {
            buffer: PNG_BYTES,
            filename: 'foto.pdf',
            contentType: 'application/pdf',
          },
        }),
      );
      await expectRejected(
        upload(tokenA, patientId, {
          file: {
            buffer: PNG_BYTES,
            filename: 'foto.pdf',
            contentType: 'image/png',
          },
        }),
      );
    });

    it('un PDF real con mime application/octet-stream da 400', async () => {
      await expectRejected(
        upload(tokenA, patientId, {
          file: {
            buffer: pdfBytes('ok'),
            filename: 'a.pdf',
            contentType: 'application/octet-stream',
          },
        }),
      );
    });

    it('texto plano con mime pdf da 400', async () => {
      await expectRejected(
        upload(tokenA, patientId, {
          file: {
            buffer: Buffer.from('hola mundo'),
            filename: 'a.pdf',
            contentType: 'application/pdf',
          },
        }),
      );
    });

    it('un archivo que supera el límite de 25 MB se rechaza con 413', async () => {
      const big = Buffer.concat([
        Buffer.from('%PDF-1.4\n'),
        Buffer.alloc(25 * 1024 * 1024 + 1024, 0x20),
      ]);
      await expectRejected(
        upload(tokenA, patientId, {
          file: {
            buffer: big,
            filename: 'grande.pdf',
            contentType: 'application/pdf',
          },
        }),
        413,
      );
    });

    it('rechaza mass assignment (source, status, hashes, versión, firmante)', async () => {
      for (const field of [
        'source',
        'status',
        'contentHash',
        'pdfSha256',
        'version',
        'groupId',
        'correctsId',
        'signerName',
        'therapistId',
        'documentId',
      ]) {
        await expectRejected(
          upload(tokenA, patientId, {
            fields: { closureReason: 'DISCHARGED', [field]: 'x' },
          }),
        );
      }
    });

    it('aplica las reglas de cierre: ACTIVE, deserción sin motivo, motivo con otro cierre, fecha futura', async () => {
      const cases: Record<string, string>[] = [
        { closureReason: 'ACTIVE' },
        { closureReason: 'DROPPED_OUT' },
        { closureReason: 'DISCHARGED', dropoutReason: 'RELOCATION_OR_ACCESS' },
        { closureReason: 'DISCHARGED', referralDestination: 'CESFAM' },
        { closureReason: 'DISCHARGED', dischargeDate: '2999-01-01' },
        { closureReason: 'DISCHARGED', dischargeDate: '2026-02-30' },
        {},
      ];
      for (const fields of cases) {
        await expectRejected(upload(tokenA, patientId, { fields }));
      }
    });
  });

  describe('consentimiento', () => {
    it('sin consentimiento TREATMENT vigente da 403 y no deja documento huérfano', async () => {
      const patientId = await createPatient(false);
      await upload(tokenA, patientId).expect(403);
      expect(await patientStatus(patientId)).toBe('ACTIVE');
      expect(await reportDocs(patientId)).toHaveLength(0);
    });
  });

  describe('cierres con deserción y derivación', () => {
    it('acepta deserción con motivo y derivación con destino', async () => {
      const dropped = await createPatient();
      const res = await upload(tokenA, dropped, {
        fields: {
          closureReason: 'DROPPED_OUT',
          dropoutReason: 'RELOCATION_OR_ACCESS',
        },
      }).expect(201);
      expect((res.body as Body).dropoutReason).toBe('RELOCATION_OR_ACCESS');
      expect(await patientStatus(dropped)).toBe('DROPPED_OUT');

      const referred = await createPatient();
      await upload(tokenA, referred, {
        fields: { closureReason: 'REFERRED', referralDestination: 'CESFAM' },
      }).expect(201);
      expect(await patientStatus(referred)).toBe('REFERRED');
    });
  });

  describe('subidas concurrentes del mismo paciente', () => {
    it('solo una cierra; la otra recibe 409 y no deja documento sobrante', async () => {
      const patientId = await createPatient();
      const results = await Promise.all([
        upload(tokenA, patientId, {
          file: {
            buffer: pdfBytes('c1'),
            filename: 'c1.pdf',
            contentType: 'application/pdf',
          },
        }),
        upload(tokenA, patientId, {
          file: {
            buffer: pdfBytes('c2'),
            filename: 'c2.pdf',
            contentType: 'application/pdf',
          },
        }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      expect(
        await prisma.treatmentDischarge.count({ where: { patientId } }),
      ).toBe(1);
      expect(await reportDocs(patientId)).toHaveLength(1);
      expect(await patientStatus(patientId)).toBe('DISCHARGED');
    });
  });

  describe('reemplazo versionado (correct-upload)', () => {
    let patientId: string;
    let v1: Body;
    let v2: Body;

    beforeAll(async () => {
      patientId = await createPatient();
      v1 = (await upload(tokenA, patientId).expect(201)).body as Body;
    });

    it('crea la versión 2 emitida, anula el PDF anterior y deja el nuevo vigente', async () => {
      const bytes2 = pdfBytes('v2');
      const res = await correctUpload(tokenA, v1.id as string, bytes2, {
        closureReason: 'REFERRED',
        referralDestination: 'COSAM',
      }).expect(201);
      v2 = res.body as Body;

      expect(v2).toMatchObject({
        groupId: v1.groupId,
        version: 2,
        correctsId: v1.id,
        source: 'UPLOADED',
        status: 'ISSUED',
        closureReason: 'REFERRED',
        contentHash: sha256(bytes2),
      });
      expect(v2.documentId).not.toBe(v1.documentId);

      const oldDoc = await prisma.patientDocument.findUniqueOrThrow({
        where: { id: v1.documentId as string },
      });
      const newDoc = await prisma.patientDocument.findUniqueOrThrow({
        where: { id: v2.documentId as string },
      });
      expect(oldDoc.voidedAt).not.toBeNull();
      expect(oldDoc.voidedById).toBe(therapistAId);
      expect(newDoc.voidedAt).toBeNull();

      // El paciente sigue cerrado, ahora con el nuevo motivo.
      expect(await patientStatus(patientId)).toBe('REFERRED');

      const verify1 = await get(
        tokenA,
        `discharges/${v1.id as string}/verify`,
      ).expect(200);
      expect((verify1.body as Body).isCurrent).toBe(false);
      const pdf2 = await getPdf(tokenA, v2.id as string).expect(200);
      expect((pdf2.body as Buffer).equals(bytes2)).toBe(true);
    });

    it('no admite corregir dos veces la misma versión (409)', async () => {
      await correctUpload(tokenA, v1.id as string, pdfBytes('v3')).expect(409);
      expect(await reportDocs(patientId)).toHaveLength(2);
    });

    it('la corrección normal sobre un informe subido da 409 e indica correct-upload', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/discharges/${v2.id as string}/correct`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(409);
      expect(JSON.stringify(res.body)).toContain('correct-upload');
    });

    it('rechaza un archivo no PDF sin anular nada', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/discharges/${v2.id as string}/correct-upload`)
        .set('Authorization', `Bearer ${tokenA}`)
        .field('closureReason', 'REFERRED')
        .attach('file', EXE_BYTES, {
          filename: 'x.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(400);
      const doc = await prisma.patientDocument.findUniqueOrThrow({
        where: { id: v2.documentId as string },
      });
      expect(doc.voidedAt).toBeNull();
    });

    it('con el paciente reabierto registra la versión sin tocar su estado', async () => {
      await prisma.patient.update({
        where: { id: patientId },
        data: { treatmentStatus: 'ACTIVE' },
      });
      const res = await correctUpload(tokenA, v2.id as string, pdfBytes('v3'), {
        closureReason: 'DISCHARGED',
      }).expect(201);
      expect((res.body as Body).version).toBe(3);
      expect(await patientStatus(patientId)).toBe('ACTIVE');
    });

    it('correct-upload sobre un informe GENERATED da 409', async () => {
      const gen = await createPatient();
      const draft = await request(app.getHttpServer())
        .post(`/api/v1/patients/${gen}/discharges`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ closureReason: 'DISCHARGED' })
        .expect(201);
      const draftId = (draft.body as Body).id as string;
      // Un borrador no se reemplaza con archivo.
      await correctUpload(tokenA, draftId, pdfBytes('x')).expect(409);
    });
  });
});
