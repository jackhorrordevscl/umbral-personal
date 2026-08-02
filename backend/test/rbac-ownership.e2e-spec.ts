import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as fs from 'fs';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * T1.5 (issue #10), reescrito para el modelo de un solo rol (issue #7):
 * verifica que los endpoints sensibles (consultas, reportes, documentos,
 * pacientes) respeten la relación terapeuta-paciente aplicada por
 * PatientsService.findOne(patientId, userId):
 *   - el dueño (Patient.therapistId === userId) accede (2xx)
 *   - un PROFESSIONAL sin relación con el paciente recibe 403
 *
 * Tras el colapso de roles (b0354c0) ya no existe POST /users (era CRUD
 * institucional, reemplazado por ProfileModule): los fixtures se crean
 * directo vía Prisma con argon2, igual que hace seed.ts. MFA es obligatorio
 * para toda cuenta, así que cada fixture pasa por el enrolamiento forzado
 * (login -> mfa/setup/begin -> mfa/setup/confirm) antes de poder usarse.
 *
 * Los fixtures se crean en beforeAll con emails únicos por corrida (sufijo
 * Date.now()) para que la suite sea repetible sobre la misma base sin
 * colisionar con datos de pruebas manuales previas, y se eliminan en
 * afterAll.
 */
describe('RBAC ownership guard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';

  let therapistAToken: string;
  let therapistBToken: string;
  let therapistAId: string;
  let therapistBId: string;

  let patientId: string;
  let consultationId: string;
  let ownerDocumentId: string;

  // Crea un usuario PROFESSIONAL directo vía Prisma (no existe POST /users
  // tras el colapso de roles) y completa el enrolamiento MFA forzado, que
  // aplica a toda cuenta sin excepción. Devuelve el accessToken de sesión.
  async function createProfessionalAndLogin(email: string, name: string): Promise<{ id: string; token: string }> {
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email, passwordHash, name },
    });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);
    expect(login.body.requiresMfaSetup).toBe(true);

    const beginSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({ setupToken: login.body.setupToken })
      .expect(201);

    const totp = speakeasy.totp({
      secret: beginSetup.body.secret,
      encoding: 'base32',
    });

    const confirmSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({ setupToken: login.body.setupToken, token: totp })
      .expect(201);

    return { id: user.id, token: confirmSetup.body.accessToken };
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
      `rbac.therapist.a.${runId}@umbral.cl`,
      'RBAC Therapist A',
    );
    therapistAId = therapistA.id;
    therapistAToken = therapistA.token;

    const therapistB = await createProfessionalAndLogin(
      `rbac.therapist.b.${runId}@umbral.cl`,
      'RBAC Therapist B',
    );
    therapistBId = therapistB.id;
    therapistBToken = therapistB.token;

    // Con el token de A: crear un paciente y una consulta para ese paciente
    const patientCreate = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .send({
        fullName: 'RBAC Test Patient',
        rut: `RBAC${runId}`,
        birthDate: '1990-01-01',
      })
      .expect(201);
    patientId = patientCreate.body.id;

    const consultationCreate = await request(app.getHttpServer())
      .post('/api/v1/consultations')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .send({
        patientId,
        sessionDate: '2026-01-01',
        consultReason: 'Motivo de prueba RBAC',
        intervention: 'Intervención de prueba RBAC',
      })
      .expect(201);
    consultationId = consultationCreate.body.id;
  });

  afterAll(async () => {
    try {
      // Guard explícito: si beforeAll falló antes de crear el paciente
      // fixture, patientId queda undefined. `where: { patientId: undefined }`
      // / `where: { id: undefined }` en Prisma NO filtra por "ningún match":
      // significa "sin filtro en ese campo", así que deleteMany() borraría
      // TODOS los pacientes/documentos/consultas de la base.
      if (patientId) {
        // Limpieza de archivos físicos subidos durante la suite
        const docs = await prisma.patientDocument.findMany({
          where: { patientId },
        });
        for (const doc of docs) {
          try {
            fs.unlinkSync(doc.storagePath);
          } catch {
            // el archivo puede no existir (p.ej. intento no-dueño ya autolimpiado); se ignora
          }
        }

        // Borrado respetando FKs: documentos/consultas -> paciente.
        await prisma.patientDocument.deleteMany({ where: { patientId } });
        await prisma.consultationHistory.deleteMany({
          where: { consultation: { patientId } },
        });
        await prisma.consultation.deleteMany({ where: { patientId } });
        await prisma.patient.deleteMany({ where: { id: patientId } });
      }

      // Los usuarios de prueba ya generaron filas en AuditLog durante la
      // suite (cada request autenticado audita). AuditLog.userId usa
      // onDelete: Restrict a propósito (T2.1) para que hard-deletear un
      // usuario con historial de auditoría sea imposible — igual que en
      // producción, donde no existe ningún prisma.user.delete(), solo
      // soft delete.
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
    it('GET /patients/:id sin Authorization header devuelve 401', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}`)
        .expect(401);
    });
  });

  describe('GET /patients/:id', () => {
    it('el terapeuta dueño accede (2xx)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });
  });

  describe('POST /documents/upload', () => {
    it('el terapeuta dueño puede subir un documento (2xx)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .field('patientId', patientId)
        .field('type', 'OTHER')
        .attach('file', Buffer.from('contenido de prueba'), 'test-owner.pdf')
        .expect(201);
      ownerDocumentId = res.body.id;
      expect(ownerDocumentId).toBeDefined();
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .field('patientId', patientId)
        .field('type', 'OTHER')
        .attach('file', Buffer.from('contenido de prueba'), 'test-nonowner.pdf')
        .expect(403);
    });
  });

  describe('GET /documents/patient/:patientId', () => {
    it('el terapeuta dueño accede (2xx)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/documents/patient/${patientId}`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/documents/patient/${patientId}`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });
  });

  describe('GET /documents/:id/download', () => {
    it('el terapeuta dueño accede (2xx)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/documents/${ownerDocumentId}/download`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/documents/${ownerDocumentId}/download`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });
  });

  describe('POST /consultations', () => {
    it('un terapeuta sin relación con el paciente recibe 403 (issue #12)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/consultations')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .send({
          patientId,
          sessionDate: '2026-01-02',
          consultReason: 'Intento no autorizado',
          intervention: 'Intento no autorizado',
        })
        .expect(403);
    });
  });

  describe('GET /consultations/patient/:patientId', () => {
    it('el terapeuta dueño accede (2xx)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/consultations/patient/${patientId}`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/consultations/patient/${patientId}`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });
  });

  describe('GET /consultations/:id', () => {
    it('el terapeuta dueño accede (2xx)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/consultations/${consultationId}`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/consultations/${consultationId}`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });
  });

  describe('PATCH /consultations/:id/correct (versionado inmutable, T2.3)', () => {
    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/consultations/${consultationId}/correct`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .send({ consultReason: 'Intento no autorizado' })
        .expect(403);
    });

    it('el terapeuta dueño puede corregir: crea una versión nueva (2xx)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/consultations/${consultationId}/correct`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({ consultReason: 'Motivo corregido por el dueño' })
        .expect(200);

      const correctedId = res.body.id;
      expect(correctedId).toBeDefined();
      expect(correctedId).not.toBe(consultationId);
      expect(res.body.consultReason).toBe('Motivo corregido por el dueño');
      expect(res.body.history.length).toBe(1);
    });

    it('la versión original queda intacta y consultable por su id original', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/consultations/${consultationId}`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);

      expect(res.body.id).toBe(consultationId);
      expect(res.body.consultReason).toBe('Motivo de prueba RBAC');
    });

    it('corregir la versión original ya superada devuelve 409', () => {
      return request(app.getHttpServer())
        .patch(`/api/v1/consultations/${consultationId}/correct`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .send({ consultReason: 'Intento sobre versión vieja' })
        .expect(409);
    });
  });

  describe('GET /reports/patient/:patientId', () => {
    it('el terapeuta dueño accede (2xx)', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/reports/patient/${patientId}`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200)
        .expect('Content-Type', 'application/pdf');
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/reports/patient/${patientId}`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });
  });
});
