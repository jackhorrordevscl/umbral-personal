import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * El :therapistId de las rutas públicas acepta el slug del terapeuta o su
 * UUID (los links anteriores deben seguir funcionando). Postgres real, mismo
 * criterio que public-scheduling.e2e-spec.ts.
 */
describe('Public therapist slug (e2e)', () => {
  const ORIGINAL_SCHEDULING_FLAG = process.env.PUBLIC_SCHEDULING_ENABLED;

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let therapistId: string;

  const runId = Date.now();
  const slug = `slug-e2e-${runId}`;
  const availabilityQuery =
    'from=2099-01-05T00:00:00-03:00&to=2099-01-12T00:00:00-03:00';

  beforeAll(async () => {
    process.env.PUBLIC_SCHEDULING_ENABLED = 'true';

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
    const therapist = await prisma.user.create({
      data: {
        email: `public-slug.${runId}@umbral.cl`,
        passwordHash: 'x',
        name: 'Slug E2E Therapist',
        slug,
        specialty: 'Ansiedad',
      },
    });
    therapistId = therapist.id;
  }, 30000);

  afterAll(async () => {
    try {
      await prisma.user.update({
        where: { id: therapistId },
        data: { deletedAt: new Date() },
      });
    } finally {
      if (ORIGINAL_SCHEDULING_FLAG === undefined) {
        delete process.env.PUBLIC_SCHEDULING_ENABLED;
      } else {
        process.env.PUBLIC_SCHEDULING_ENABLED = ORIGINAL_SCHEDULING_FLAG;
      }
      await app.close();
    }
  });

  it('el perfil público responde igual por slug y por UUID, sin exponer email', async () => {
    const bySlug = await request(app.getHttpServer())
      .get(`/api/v1/public/therapists/${slug}/profile`)
      .expect(200);
    const byId = await request(app.getHttpServer())
      .get(`/api/v1/public/therapists/${therapistId}/profile`)
      .expect(200);

    expect(bySlug.body).toEqual(byId.body);
    expect(bySlug.body).toMatchObject({
      name: 'Slug E2E Therapist',
      specialty: 'Ansiedad',
    });
    expect(bySlug.body).not.toHaveProperty('email');
  });

  it('un slug desconocido responde 404 en el perfil', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/public/therapists/slug-que-no-existe/profile')
      .expect(404);
  });

  it('la disponibilidad responde 200 por slug, y [] para un slug desconocido', async () => {
    const bySlug = await request(app.getHttpServer())
      .get(
        `/api/v1/public/therapists/${slug}/availability?${availabilityQuery}`,
      )
      .expect(200);
    expect(bySlug.body).toEqual([]);

    await request(app.getHttpServer())
      .get(
        `/api/v1/public/therapists/slug-que-no-existe/availability?${availabilityQuery}`,
      )
      .expect(200)
      .expect([]);
  });

  it('reservar con un slug desconocido responde 404', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/public/therapists/slug-que-no-existe/availability/book')
      .send({
        slotStart: '2099-01-05T13:00:00.000Z',
        patient: {
          fullName: 'Paciente Slug',
          rut: '11.111.111-1',
          birthDate: '1990-01-01',
          email: `paciente-slug.${runId}@ejemplo.cl`,
        },
      })
      .expect(404);
  });
});
