import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { uniqueTestRut } from './support/unique-rut';

/**
 * Issue #290: GET /patients siempre responde { data, total, page, pageSize },
 * busca por nombre/RUT en el servidor y GET /patients/summary entrega los
 * contadores del dashboard sin traer la lista.
 */
describe('Patients list, search and summary (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';

  let therapistAId: string;
  let therapistBId: string;
  let therapistAToken: string;
  let therapistBToken: string;
  let ruts: string[] = [];
  const patientIds: string[] = [];

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
    const setupToken = (login.body as Record<string, unknown>)
      .setupToken as string;

    const beginSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({ setupToken })
      .expect(201);

    const totp = speakeasy.totp({
      secret: (beginSetup.body as Record<string, unknown>).secret as string,
      encoding: 'base32',
    });

    const confirmSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({ setupToken, token: totp })
      .expect(201);

    return {
      id: user.id,
      token: (confirmSetup.body as Record<string, unknown>)
        .accessToken as string,
    };
  }

  function createPatient(token: string, fullName: string, rut: string) {
    return request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName, rut, birthDate: '1990-01-01' });
  }

  async function recordConsent(
    token: string,
    patientId: string,
    purpose: 'TREATMENT' | 'TELEMEDICINE',
    action: 'GRANT' | 'REVOKE',
  ) {
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/consents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ purpose, action, evidence: 'Evidencia de prueba e2e' })
      .expect(201);
  }

  interface ListBody {
    data: { id: string; fullName: string; consents: Record<string, boolean> }[];
    total: number;
    page: number;
    pageSize: number;
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
      `list.therapist.a.${runId}@umbral.cl`,
      'List Therapist A',
    );
    therapistAId = therapistA.id;
    therapistAToken = therapistA.token;

    const therapistB = await createProfessionalAndLogin(
      `list.therapist.b.${runId}@umbral.cl`,
      'List Therapist B',
    );
    therapistBId = therapistB.id;
    therapistBToken = therapistB.token;

    const names = ['Zulema Quispe', 'Ana Zuleta', 'Bruno Díaz'];
    ruts = names.map(() => uniqueTestRut());
    for (const [i, name] of names.entries()) {
      const res = await createPatient(therapistAToken, name, ruts[i]).expect(
        201,
      );
      patientIds.push((res.body as { id: string }).id);
    }
    await createPatient(
      therapistBToken,
      'Zulema Ajena',
      uniqueTestRut(),
    ).expect(201);
  });

  afterAll(async () => {
    try {
      const therapistIds = [therapistAId, therapistBId].filter(Boolean);
      if (therapistIds.length > 0) {
        await prisma.patientConsent.deleteMany({
          where: { patientId: { in: patientIds } },
        });
        await prisma.patient.deleteMany({
          where: { therapistId: { in: therapistIds } },
        });
        await prisma.user.updateMany({
          where: { id: { in: therapistIds } },
          data: { deletedAt: new Date() },
        });
      }
    } finally {
      await app.close();
    }
  });

  it('sin parámetros devuelve { data, total, page, pageSize } solo con pacientes propios', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/patients')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .expect(200);
    const body = res.body as ListBody;

    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.data).toHaveLength(3);
    expect(body.data[0].consents).toEqual({
      TREATMENT: false,
      TELEMEDICINE: false,
    });
  });

  it('pagina con page/pageSize y mantiene total', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/patients?page=2&pageSize=2')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .expect(200);
    const body = res.body as ListBody;

    expect(body.total).toBe(3);
    expect(body.data).toHaveLength(1);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(2);
  });

  it('search por nombre es insensible a mayúsculas y no ve pacientes de otros terapeutas', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/patients?search=zule')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .expect(200);
    const body = res.body as ListBody;

    expect(body.total).toBe(2);
    expect(body.data.map((p) => p.fullName).sort()).toEqual([
      'Ana Zuleta',
      'Zulema Quispe',
    ]);
  });

  it('search por RUT acepta el formato con puntos y DV en minúscula', async () => {
    const [digits, dv] = ruts[2].split('-');
    const dotted = `${digits.slice(0, -6)}.${digits.slice(-6, -3)}.${digits.slice(-3)}-${dv.toLowerCase()}`;
    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients?search=${encodeURIComponent(dotted)}`)
      .set('Authorization', `Bearer ${therapistAToken}`)
      .expect(200);
    const result = res.body as ListBody;

    expect(result.total).toBe(1);
    expect(result.data[0].fullName).toBe('Bruno Díaz');
  });

  it('GET /patients/summary no se confunde con :id y cuenta consentimientos vigentes', async () => {
    const initial = await request(app.getHttpServer())
      .get('/api/v1/patients/summary')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .expect(200);
    expect(initial.body).toEqual({ total: 3, withConsent: 0 });

    await recordConsent(therapistAToken, patientIds[0], 'TREATMENT', 'GRANT');
    // Dos finalidades vigentes del mismo paciente cuentan una sola vez.
    await recordConsent(
      therapistAToken,
      patientIds[0],
      'TELEMEDICINE',
      'GRANT',
    );
    await recordConsent(therapistAToken, patientIds[1], 'TREATMENT', 'GRANT');
    // Un GRANT revocado después ya no cuenta.
    await recordConsent(therapistAToken, patientIds[1], 'TREATMENT', 'REVOKE');

    const after = await request(app.getHttpServer())
      .get('/api/v1/patients/summary')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .expect(200);
    expect(after.body).toEqual({ total: 3, withConsent: 1 });

    const other = await request(app.getHttpServer())
      .get('/api/v1/patients/summary')
      .set('Authorization', `Bearer ${therapistBToken}`)
      .expect(200);
    expect(other.body).toEqual({ total: 1, withConsent: 0 });
  });

  it('rechaza pageSize fuera de rango', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/patients?pageSize=1000')
      .set('Authorization', `Bearer ${therapistAToken}`)
      .expect(400);
  });
});
