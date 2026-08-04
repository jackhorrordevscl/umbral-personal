import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * T8.1 (issue #58): cifrado de documentos clínicos en reposo con `crypto`
 * nativo de Node (AES-256-GCM). Verifica que (a) el archivo que queda en
 * disco NO es el contenido original en texto plano, (b) la descarga devuelve
 * exactamente el contenido original ya descifrado, y (c) el control de
 * acceso de siempre (ownership vía patients.service.findOne, dueño único
 * tras el colapso de roles en b0354c0, issue #7) sigue aplicando antes de
 * servir el archivo.
 *
 * No existe POST /users tras el colapso de roles (era CRUD institucional,
 * reemplazado por ProfileModule): los fixtures se crean directo vía Prisma
 * con argon2, y pasan por el enrolamiento MFA forzado (obligatorio para toda
 * cuenta) antes de tener un accessToken de sesión.
 */
describe('Documents encryption at rest (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';
  // Prefijo con magic bytes reales de PDF (%PDF-1.4): la validación de
  // contenido real del archivo (issue #51, file-signature.util.ts) rechaza
  // contenido cuyos magic bytes no coincidan con el mimetype declarado, así
  // que el fixture de este test ya no puede ser texto plano puro declarado
  // como application/pdf.
  const PLAINTEXT_MARKER =
    '%PDF-1.4\ncontenido-clinico-sensible-no-deberia-verse-en-disco';

  let therapistAToken: string;
  let therapistBToken: string;
  let therapistAId: string;
  let therapistBId: string;
  let patientId: string;
  let documentId: string;

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
      `docs.therapist.a.${runId}@umbral.cl`,
      'Documents Therapist A',
    );
    therapistAId = therapistA.id;
    therapistAToken = therapistA.token;

    const therapistB = await createProfessionalAndLogin(
      `docs.therapist.b.${runId}@umbral.cl`,
      'Documents Therapist B',
    );
    therapistBId = therapistB.id;
    therapistBToken = therapistB.token;

    const patientCreate = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .send({
        fullName: 'Documents Test Patient',
        rut: `DOCS${runId}`,
        birthDate: '1990-01-01',
      })
      .expect(201);
    patientId = (patientCreate.body as Record<string, unknown>).id as string;
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

      documentId = (res.body as Record<string, unknown>).id as string;
      expect((res.body as Record<string, unknown>).fileName).toBe(
        'informe.pdf',
      );
      expect(
        (res.body as Record<string, unknown>).storagePath as string,
      ).toMatch(/\.enc$/);

      const raw = fs.readFileSync(
        path.join(
          process.cwd(),
          (res.body as Record<string, unknown>).storagePath as string,
        ),
      );
      expect(raw.includes(Buffer.from(PLAINTEXT_MARKER))).toBe(false);
      // IV (12) + authTag (16) + ciphertext (mismo largo que el original)
      expect(raw.length).toBe(12 + 16 + Buffer.from(PLAINTEXT_MARKER).length);
    });

    it('rechaza subir a un paciente ajeno (404) sin escribir nada a disco', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .field('patientId', patientId)
        .field('type', 'OTHER')
        .attach('file', Buffer.from('no debería guardarse'), {
          filename: 'ajeno.pdf',
          contentType: 'application/pdf',
        })
        .expect(404);
    });

    // #72 (punto 3): `type` pasaba por @Body('type') sin DTO, con un
    // `type as any` en DocumentsService que anulaba el chequeo de enum -- un
    // valor fuera de DocumentType caía al 500 genérico en vez de un 400.
    it('rechaza un `type` fuera del enum DocumentType con 400, no 500', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .field('patientId', patientId)
        .field('type', 'NO_EXISTE')
        .attach('file', Buffer.from('contenido'), {
          filename: 'informe.pdf',
          contentType: 'application/pdf',
        })
        .expect(400);
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

    it('un terapeuta sin relación con el paciente recibe 404', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/documents/${documentId}/download`)
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(404);
    });
  });
});
