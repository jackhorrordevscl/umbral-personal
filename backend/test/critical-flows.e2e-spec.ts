import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MfaSecretCryptoService } from '../src/modules/auth/mfa-secret-crypto.service';
import { uniqueTestRut } from './support/unique-rut';

/**
 * T7.2 (issue #31): cobertura e2e de los flujos críticos exigidos por el
 * criterio de aceptación: login, creación de ficha, corrección de consulta,
 * exportación de PDF.
 *
 * Corrección de consulta y exportación de PDF ya están cubiertas en
 * rbac-ownership.e2e-spec.ts (PATCH /consultations/:id/correct, GET
 * /reports/patient/:patientId). Este archivo cubre lo que faltaba: el flujo
 * normal de login (éxito y fallos) y la creación de ficha (éxito y
 * validaciones), que hasta ahora solo se usaban como setup de otros tests,
 * nunca como flujo propio verificado.
 *
 * Reescrito para el modelo de un solo rol (issue #7): no existe POST /users
 * tras el colapso de roles (era CRUD institucional, reemplazado por
 * ProfileModule), y MFA es obligatorio para toda cuenta -- el fixture se
 * crea directo vía Prisma y pasa por el enrolamiento forzado antes de tener
 * un accessToken de sesión.
 */
describe('Critical flows (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';

  let therapistEmail: string;
  let therapistToken: string;
  let therapistId: string;

  const createdPatientIds: string[] = [];

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

    therapistEmail = `critical-flows.therapist.${runId}@umbral.cl`;
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const therapist = await prisma.user.create({
      data: {
        email: therapistEmail,
        passwordHash,
        name: 'Critical Flows Therapist',
      },
    });
    therapistId = therapist.id;

    // MFA es obligatorio para toda cuenta: se completa el enrolamiento
    // forzado una vez acá, fuera del describe de login (que ejercita el
    // flujo de login en sí mismo con un login POSTERIOR, ya con MFA activo).
    const bootstrapLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: therapistEmail, password: TEST_PASSWORD })
      .expect(201);
    expect(
      (bootstrapLogin.body as Record<string, unknown>).requiresMfaSetup,
    ).toBe(true);

    const beginSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({
        setupToken: (bootstrapLogin.body as Record<string, unknown>)
          .setupToken as string,
      })
      .expect(201);

    const totp = speakeasy.totp({
      secret: (beginSetup.body as Record<string, unknown>).secret as string,
      encoding: 'base32',
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({
        setupToken: (bootstrapLogin.body as Record<string, unknown>)
          .setupToken as string,
        token: totp,
      })
      .expect(201);
  });

  afterAll(async () => {
    try {
      if (createdPatientIds.length > 0) {
        await prisma.patientConsent.deleteMany({
          where: { patientId: { in: createdPatientIds } },
        });
        await prisma.patient.deleteMany({
          where: { id: { in: createdPatientIds } },
        });
      }

      if (therapistId) {
        await prisma.user.updateMany({
          where: { id: therapistId },
          data: { deletedAt: new Date() },
        });
      }
    } finally {
      await app.close();
    }
  });

  describe('POST /auth/login', () => {
    it('login exitoso con MFA ya enrolado responde requiresMfa con mfaToken (sin userId), sin accessToken directo', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: therapistEmail, password: TEST_PASSWORD })
        .expect(201);

      expect((res.body as Record<string, unknown>).requiresMfa).toBe(true);
      expect(typeof (res.body as Record<string, unknown>).mfaToken).toBe(
        'string',
      );
      expect((res.body as Record<string, unknown>).userId).toBeUndefined();
      expect(
        (res.body as Record<string, unknown>).accessToken as string,
      ).toBeUndefined();
    });

    it('login + mfa/verify con TOTP válido entrega accessToken y datos del usuario', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: therapistEmail, password: TEST_PASSWORD })
        .expect(201);

      const user = await prisma.user.findUnique({ where: { id: therapistId } });
      // The enrollment in beforeAll already consumed the current TOTP step
      // (replay protection, issue #302), so use the next step. It is within
      // the server's window of 1.
      const totp = speakeasy.totp({
        // mfaSecret is encrypted at rest (issue #302): decrypt to sign a TOTP.
        secret: app.get(MfaSecretCryptoService).decrypt(user!.mfaSecret!),
        encoding: 'base32',
        time: Math.floor(Date.now() / 1000) + 30,
      });

      const verifyRes = await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({
          mfaToken: (loginRes.body as Record<string, unknown>).mfaToken,
          token: totp,
        })
        .expect(201);

      // Replaying the same TOTP step with a fresh mfaToken is rejected.
      const replayLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: therapistEmail, password: TEST_PASSWORD })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({
          mfaToken: (replayLogin.body as Record<string, unknown>).mfaToken,
          token: totp,
        })
        .expect(401);

      expect(
        (verifyRes.body as Record<string, unknown>).accessToken as string,
      ).toBeDefined();
      expect((verifyRes.body as Record<string, unknown>).user).toEqual({
        id: therapistId,
        email: therapistEmail,
        role: 'PROFESSIONAL',
        name: 'Critical Flows Therapist',
      });

      therapistToken = (verifyRes.body as Record<string, unknown>)
        .accessToken as string;
    });

    it('mfa/verify rechaza un userId crudo sin mfaToken (no se salta el paso de contraseña)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({ userId: therapistId, token: '123456' })
        .expect(400);
    });

    it('mfa/verify rechaza con 401 un JWT que no es mfa-verify', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({ mfaToken: 'not-a-jwt', token: '123456' })
        .expect(401);
    });

    it('rechaza con 401 una contraseña incorrecta', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: therapistEmail, password: 'contraseña-incorrecta' })
        .expect(401);
    });

    it('rechaza con 401 un email que no existe', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: `no-existe.${runId}@umbral.cl`,
          password: TEST_PASSWORD,
        })
        .expect(401);
    });
  });

  describe('POST /patients (creación de ficha)', () => {
    it('sin Authorization header devuelve 401', () => {
      return request(app.getHttpServer())
        .post('/api/v1/patients')
        .send({
          fullName: 'Paciente Sin Auth',
          rut: uniqueTestRut(),
          birthDate: '1990-01-01',
        })
        .expect(401);
    });

    it('crea la ficha con los datos mínimos requeridos (2xx) y queda asociada al terapeuta autenticado', async () => {
      expect(therapistToken).toBeDefined();

      const res = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          fullName: 'Paciente Flujo Crítico',
          rut: uniqueTestRut(),
          birthDate: '1990-01-01',
        })
        .expect(201);

      expect((res.body as Record<string, unknown>).id as string).toBeDefined();
      expect((res.body as Record<string, unknown>).fullName).toBe(
        'Paciente Flujo Crítico',
      );
      expect((res.body as Record<string, unknown>).therapistId).toBe(
        therapistId,
      );
      createdPatientIds.push(
        (res.body as Record<string, unknown>).id as string,
      );
    });

    it('rechaza con 400 si falta un campo requerido (fullName)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          rut: uniqueTestRut(),
          birthDate: '1990-01-01',
        })
        .expect(400);
    });

    it('rechaza con 400 un birthDate que no es una fecha válida', () => {
      return request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          fullName: 'Paciente Fecha Inválida',
          rut: uniqueTestRut(),
          birthDate: 'no-es-una-fecha',
        })
        .expect(400);
    });

    it('rechaza con 400 campos no declarados en el DTO (whitelist/forbidNonWhitelisted)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          fullName: 'Paciente Campo Extra',
          rut: uniqueTestRut(),
          birthDate: '1990-01-01',
          campoNoDeclarado: 'no debería aceptarse',
        })
        .expect(400);
    });
  });
});
