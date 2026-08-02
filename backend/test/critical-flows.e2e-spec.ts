import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SEED_ADMIN_EMAIL_DEFAULT,
  SEED_ADMIN_PASSWORD_DEFAULT,
} from '../prisma/seed-admin.defaults';

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
 */
describe('Critical flows (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? SEED_ADMIN_EMAIL_DEFAULT;
  const ADMIN_PASSWORD =
    process.env.SEED_ADMIN_PASSWORD ?? SEED_ADMIN_PASSWORD_DEFAULT;
  const TEST_PASSWORD = 'TestPass123!';

  let adminToken: string;
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

    // T4.1 (issue #19): ADMIN/SUPERVISOR quedan forzados a enrolar MFA en su
    // primer login sin MFA. Se resetea el estado MFA del ADMIN seedeado
    // antes de loguear, igual que en el resto de los e2e-specs.
    await prisma.user.updateMany({
      where: { email: ADMIN_EMAIL },
      data: { mfaEnabled: false, mfaSecret: null, mustChangePassword: false },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(201);
    expect(adminLogin.body.requiresMfaSetup).toBe(true);

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

    therapistEmail = `critical-flows.therapist.${runId}@umbral.cl`;
    const therapistCreate = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: therapistEmail,
        password: TEST_PASSWORD,
        name: 'Critical Flows Therapist',
        role: 'THERAPIST',
      })
      .expect(201);
    therapistId = therapistCreate.body.id;
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

      // El beforeAll enrola MFA en el admin seedeado; ningún test posterior
      // lo deshace. Mismo patrón que auth-mfa-enforcement/rbac-ownership: sin
      // este reset, el admin queda con un mfaSecret de test inservible para
      // cualquiera que loguee después.
      await prisma.user.updateMany({
        where: { email: ADMIN_EMAIL },
        data: { mfaEnabled: false, mfaSecret: null },
      });
    } finally {
      await app.close();
    }
  });

  describe('POST /auth/login', () => {
    it('login exitoso de un THERAPIST sin MFA devuelve accessToken y datos del usuario', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: therapistEmail, password: TEST_PASSWORD })
        .expect(201);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user).toEqual({
        id: therapistId,
        email: therapistEmail,
        role: 'THERAPIST',
        name: 'Critical Flows Therapist',
      });

      therapistToken = res.body.accessToken;
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
        .send({ email: `no-existe.${runId}@umbral.cl`, password: TEST_PASSWORD })
        .expect(401);
    });
  });

  describe('POST /patients (creación de ficha)', () => {
    it('sin Authorization header devuelve 401', () => {
      return request(app.getHttpServer())
        .post('/api/v1/patients')
        .send({
          fullName: 'Paciente Sin Auth',
          rut: `NOAUTH${runId}`,
          birthDate: '1990-01-01',
        })
        .expect(401);
    });

    it('crea la ficha con los datos mínimos requeridos (2xx) y queda asociada al terapeuta autenticado', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          fullName: 'Paciente Flujo Crítico',
          rut: `CRIT${runId}`,
          birthDate: '1990-01-01',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.fullName).toBe('Paciente Flujo Crítico');
      expect(res.body.therapistId).toBe(therapistId);
      createdPatientIds.push(res.body.id);
    });

    it('rechaza con 400 si falta un campo requerido (fullName)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({
          rut: `NOFULLNAME${runId}`,
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
          rut: `BADDATE${runId}`,
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
          rut: `EXTRA${runId}`,
          birthDate: '1990-01-01',
          campoNoDeclarado: 'no debería aceptarse',
        })
        .expect(400);
    });
  });
});
