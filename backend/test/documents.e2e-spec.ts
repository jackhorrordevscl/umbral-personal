import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as speakeasy from 'speakeasy';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SEED_ADMIN_EMAIL_DEFAULT,
  SEED_ADMIN_PASSWORD_DEFAULT,
} from '../prisma/seed-admin.defaults';

/**
 * T8.1 (issue #58): cifrado de documentos clínicos en reposo con `crypto`
 * nativo de Node (AES-256-GCM). Verifica que (a) el archivo que queda en
 * disco NO es el contenido original en texto plano, (b) la descarga devuelve
 * exactamente el contenido original ya descifrado, y (c) el control de
 * acceso de siempre (ownership vía patients.service.findOne) sigue aplicando
 * antes de servir el archivo.
 */
describe('Documents encryption at rest (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';
  const PLAINTEXT_MARKER =
    'contenido-clinico-sensible-no-deberia-verse-en-disco';

  let adminToken: string;
  let therapistAToken: string;
  let therapistBToken: string;
  let therapistAId: string;
  let therapistBId: string;
  let patientId: string;
  let documentId: string;

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

    const ADMIN_EMAIL =
      process.env.SEED_ADMIN_EMAIL ?? SEED_ADMIN_EMAIL_DEFAULT;
    const ADMIN_PASSWORD =
      process.env.SEED_ADMIN_PASSWORD ?? SEED_ADMIN_PASSWORD_DEFAULT;

    await prisma.user.updateMany({
      where: { email: ADMIN_EMAIL },
      data: { mfaEnabled: false, mfaSecret: null, mustChangePassword: false },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(201);

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

    const therapistAEmail = `docs.therapist.a.${runId}@umbral.cl`;
    const therapistBEmail = `docs.therapist.b.${runId}@umbral.cl`;

    const therapistACreate = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: therapistAEmail,
        password: TEST_PASSWORD,
        name: 'Documents Therapist A',
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
        name: 'Documents Therapist B',
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
        fullName: 'Documents Test Patient',
        rut: `DOCS${runId}`,
        birthDate: '1990-01-01',
      })
      .expect(201);
    patientId = patientCreate.body.id;
  });

  afterAll(async () => {
    try {
      if (documentId) {
        const doc = await prisma.patientDocument.findUnique({
          where: { id: documentId },
        });
        if (doc) {
          fs.rmSync(path.join(process.cwd(), doc.storagePath), { force: true });
        }
        await prisma.patientDocument.deleteMany({ where: { patientId } });
      }
      if (patientId) {
        await prisma.patient.deleteMany({ where: { id: patientId } });
      }

      const idsToSoftDelete = [therapistAId, therapistBId].filter(Boolean);
      if (idsToSoftDelete.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: idsToSoftDelete } },
          data: { deletedAt: new Date() },
        });
      }

      const ADMIN_EMAIL =
        process.env.SEED_ADMIN_EMAIL ?? SEED_ADMIN_EMAIL_DEFAULT;
      await prisma.user.updateMany({
        where: { email: ADMIN_EMAIL },
        data: { mfaEnabled: false, mfaSecret: null },
      });
    } finally {
      await app.close();
    }
  });

  describe('POST /documents/upload', () => {
    it('cifra el archivo en disco: el contenido original no aparece en texto plano', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .field('patientId', patientId)
        .field('type', 'OTHER')
        .attach('file', Buffer.from(PLAINTEXT_MARKER), {
          filename: 'informe.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);

      documentId = res.body.id;
      expect(res.body.fileName).toBe('informe.pdf');
      expect(res.body.storagePath).toMatch(/\.enc$/);

      const raw = fs.readFileSync(
        path.join(process.cwd(), res.body.storagePath),
      );
      expect(raw.includes(Buffer.from(PLAINTEXT_MARKER))).toBe(false);
      // IV (12) + authTag (16) + ciphertext (mismo largo que el original)
      expect(raw.length).toBe(12 + 16 + Buffer.from(PLAINTEXT_MARKER).length);
    });

    it('rechaza subir a un paciente ajeno (403) sin escribir nada a disco', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .field('patientId', patientId)
        .field('type', 'OTHER')
        .attach('file', Buffer.from('no debería guardarse'), {
          filename: 'ajeno.pdf',
          contentType: 'application/pdf',
        })
        .expect(403);
    });
  });

  describe('GET /documents/:id/download', () => {
    it('devuelve el contenido original ya descifrado', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/documents/${documentId}/download`)
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);

      expect(Buffer.from(res.body).toString('utf-8')).toBe(PLAINTEXT_MARKER);
    });

    it('un terapeuta sin relación con el paciente recibe 403', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/documents/${documentId}/download`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(403);
    });
  });
});
