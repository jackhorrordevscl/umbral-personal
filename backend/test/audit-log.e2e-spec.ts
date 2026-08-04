import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * #72 (punto 5): AuditInterceptor (global, AuditService.log()) hasta ahora
 * solo se ejercitaba con mocks -- ningún e2e hacía una request real
 * autenticada y después consultaba `AuditLog` para confirmar que la fila
 * efectivamente se escribió. Un bug que rompiera el wiring del interceptor
 * global (ej. quitado por error de app.module.ts) pasaría todos los tests
 * existentes igual, porque ninguno mira la tabla.
 *
 * AuditService.log() no se espera dentro de AuditInterceptor (fire-and-forget
 * con .catch(), ver audit.interceptor.ts) -- la fila puede escribirse
 * después de que la respuesta HTTP ya volvió al cliente, así que estos tests
 * hacen polling corto en vez de asumir que ya está escrita apenas responde.
 */
describe('AuditLog — escritura real end-to-end (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';

  let userId: string;
  let userToken: string;
  let userEmail: string;
  let patientId: string;

  async function waitForAuditLog(
    where: {
      userId: string;
      action: string;
      resource: string;
      resourceId: string;
    },
    timeoutMs = 3000,
    intervalMs = 50,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = await prisma.auditLog.findFirst({
        where: where as any,
        orderBy: { createdAt: 'desc' },
      });
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return null;
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

    userEmail = `audit-log.${runId}@umbral.cl`;
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email: userEmail, passwordHash, name: 'Audit Log Test' },
    });
    userId = user.id;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: userEmail, password: TEST_PASSWORD })
      .expect(201);

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

    userToken = confirmSetup.body.accessToken;

    // Creado directo vía Prisma (no vía API) para no depender del propio
    // comportamiento que este spec audita como parte del fixture de setup.
    const patient = await prisma.patient.create({
      data: {
        fullName: 'Audit Log Test Patient',
        rut: `AUDITLOG${runId}`,
        birthDate: new Date('1990-01-01'),
        therapistId: userId,
      },
    });
    patientId = patient.id;
  });

  afterAll(async () => {
    try {
      if (patientId) {
        await prisma.consultation.deleteMany({ where: { patientId } });
        await prisma.patient.deleteMany({ where: { id: patientId } });
      }
      // Nunca hard-delete de User: AuditLog.userId usa onDelete: Restrict a
      // propósito (issue #52), y este mismo test generó filas de auditoría.
      await prisma.user.updateMany({
        where: { email: userEmail },
        data: { deletedAt: new Date() },
      });
    } finally {
      await app.close();
    }
  });

  it('POST /consultations (creación real) escribe una fila CREATE en AuditLog', async () => {
    // AuditInterceptor resuelve resourceId desde request.body.patientId para
    // POST /consultations (no hay :id en la ruta) -- ver el comentario sobre
    // issue #36 en audit.interceptor.ts. Queda indexado por el paciente
    // dueño, no por el id de la consulta recién creada.
    await request(app.getHttpServer())
      .post('/api/v1/consultations')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        patientId,
        sessionDate: '2026-01-01',
        consultReason: 'Motivo de prueba audit-log',
        intervention: 'Intervención de prueba audit-log',
      })
      .expect(201);

    const entry = await waitForAuditLog({
      userId,
      action: 'CREATE',
      resource: 'Consultation',
      resourceId: patientId,
    });

    expect(entry).not.toBeNull();
    expect(entry?.detail).toBe('POST /api/v1/consultations');
    expect(entry?.ipAddress).toBeTruthy();
  });

  it('GET /patients/:id (lectura real) escribe una fila VIEW en AuditLog', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const entry = await waitForAuditLog({
      userId,
      action: 'VIEW',
      resource: 'Patient',
      resourceId: patientId,
    });

    expect(entry).not.toBeNull();
    expect(entry?.detail).toBe(`GET /api/v1/patients/${patientId}`);
  });
});
