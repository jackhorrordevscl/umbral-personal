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
 * Issue #314: Patient.rut es único por terapeuta (@@unique([therapistId, rut])).
 * Dos terapeutas pueden registrar el mismo RUT; el mismo terapeuta recibe 409
 * solo por sus propios pacientes, así que el 409 ya no permite sondear RUT de
 * otros terapeutas.
 */
describe('Patient RUT uniqueness per therapist (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';

  let therapistAId: string;
  let therapistBId: string;
  let therapistAToken: string;
  let therapistBToken: string;

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

  function createPatient(token: string, rut: string) {
    return request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Shared Rut Patient', rut, birthDate: '1990-01-01' });
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
      `rut.therapist.a.${runId}@umbral.cl`,
      'Rut Therapist A',
    );
    therapistAId = therapistA.id;
    therapistAToken = therapistA.token;

    const therapistB = await createProfessionalAndLogin(
      `rut.therapist.b.${runId}@umbral.cl`,
      'Rut Therapist B',
    );
    therapistBId = therapistB.id;
    therapistBToken = therapistB.token;
  });

  afterAll(async () => {
    try {
      const therapistIds = [therapistAId, therapistBId].filter(Boolean);
      if (therapistIds.length > 0) {
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

  it('allows two therapists to register a patient with the same RUT', async () => {
    const rut = uniqueTestRut();

    const first = await createPatient(therapistAToken, rut).expect(201);
    const second = await createPatient(therapistBToken, rut).expect(201);

    expect((first.body as Record<string, unknown>).therapistId).toBe(
      therapistAId,
    );
    expect((second.body as Record<string, unknown>).therapistId).toBe(
      therapistBId,
    );
  });

  it('returns 409 when the same therapist repeats a RUT', async () => {
    const rut = uniqueTestRut();

    await createPatient(therapistAToken, rut).expect(201);
    await createPatient(therapistAToken, rut).expect(409);
  });

  it('does not reveal RUTs of other therapists: no 409 for a RUT only another therapist holds', async () => {
    const rut = uniqueTestRut();

    await createPatient(therapistAToken, rut).expect(201);
    await createPatient(therapistBToken, rut).expect(201);
    await createPatient(therapistBToken, rut).expect(409);
  });
});
