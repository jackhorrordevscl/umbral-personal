import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CalendarOauthService } from '../src/modules/calendar-integration/calendar-oauth.service';
import { GoogleTokenCryptoService } from '../src/modules/calendar-integration/google-token-crypto.service';

/**
 * sdd/google-calendar-integration PR 1 (design.md "Testing Strategy"): las
 * dos superficies de seguridad que el design.md exige como RED E2E
 * obligatorio en vez de matriz de amenazas:
 *   1. `GET /callback` es la única ruta PÚBLICA del módulo (sin JwtAuthGuard
 *      -- Google redirige el navegador, el bearer interceptor de axios no
 *      participa) -- por eso es la superficie de ataque primaria: un
 *      `state` inventado o alterado (forgery) o reenviado (replay) nunca
 *      debe mutar ninguna conexión.
 *   2. Tenancy: `GET /status`/`POST /disconnect` quedan scoped exclusivamente
 *      al terapeuta autenticado (@CurrentUser(), nunca un :id de ruta) --
 *      terapeuta B nunca ve ni puede mutar la conexión de terapeuta A.
 *
 * Mismo patrón de fixtures que rbac-ownership.e2e-spec.ts /
 * notifications.e2e-spec.ts: usuarios creados directo vía Prisma +
 * enrolamiento MFA forzado, porque no existe POST /users tras el colapso de
 * roles.
 */
describe('Calendar Integration (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let oauthService: CalendarOauthService;
  let tokenCrypto: GoogleTokenCryptoService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';

  let therapistAToken: string;
  let therapistBToken: string;
  let therapistAId: string;
  let therapistBId: string;

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

  function extractStateFromAuthorizeUrl(url: string): string {
    const state = new URL(url).searchParams.get('state');
    if (!state)
      throw new Error('No se encontró "state" en la URL de authorize');
    return state;
  }

  // issue #497: el navegador que llamó a /authorize recibe una cookie que el
  // callback exige; devuelve el par `nombre=valor` listo para el header Cookie.
  function cookieFrom(authorizeResponse: {
    headers: Record<string, unknown>;
  }): string {
    const cookies = authorizeResponse.headers['set-cookie'] as string[];
    const cookie = cookies.find((c) => c.startsWith('umbral_calendar_oauth='));
    if (!cookie) throw new Error('/authorize no dejó la cookie del state');
    return cookie.split(';')[0];
  }

  // Stub del intercambio de código -> Google (jest.spyOn sobre el método
  // privado que hace la llamada real, mismo criterio que
  // calendar-oauth.service.spec.ts): evita depender de la red real de
  // Google en un e2e determinístico.
  function stubExchange(refreshToken: string) {
    return jest
      .spyOn(
        oauthService as unknown as {
          exchangeAuthorizationCode: (
            code: string,
          ) => Promise<{ refreshToken: string; scope?: string }>;
        },
        'exchangeAuthorizationCode',
      )
      .mockResolvedValue({ refreshToken, scope: 'calendar.events' });
  }

  // issue #497: /authorize responde 409 con la conexión CONNECTED. Los tests que
  // solo necesitan emitir un state parten de una conexión desconectada.
  async function markTherapistADisconnected() {
    await prisma.googleCalendarConnection.updateMany({
      where: { therapistId: therapistAId },
      data: { status: 'DISCONNECTED', refreshTokenEncrypted: null },
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
    oauthService = app.get(CalendarOauthService);
    tokenCrypto = app.get(GoogleTokenCryptoService);

    const therapistA = await createProfessionalAndLogin(
      `calendar.therapist.a.${runId}@umbral.cl`,
      'Calendar Therapist A',
    );
    therapistAId = therapistA.id;
    therapistAToken = therapistA.token;

    const therapistB = await createProfessionalAndLogin(
      `calendar.therapist.b.${runId}@umbral.cl`,
      'Calendar Therapist B',
    );
    therapistBId = therapistB.id;
    therapistBToken = therapistB.token;
  }, 30000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      const idsToClean = [therapistAId, therapistBId].filter(Boolean);
      if (idsToClean.length > 0) {
        await prisma.googleCalendarConnection.deleteMany({
          where: { therapistId: { in: idsToClean } },
        });
        await prisma.user.updateMany({
          where: { id: { in: idsToClean } },
          data: { deletedAt: new Date() },
        });
      }
    } finally {
      await app.close();
    }
  });

  describe('Guard sin token', () => {
    it('GET /calendar-integration/status sin Authorization header devuelve 401', () => {
      return request(app.getHttpServer())
        .get('/api/v1/calendar-integration/status')
        .expect(401);
    });

    it('POST /calendar-integration/authorize sin Authorization header devuelve 401', () => {
      return request(app.getHttpServer())
        .post('/api/v1/calendar-integration/authorize')
        .expect(401);
    });

    it('POST /calendar-integration/disconnect sin Authorization header devuelve 401', () => {
      return request(app.getHttpServer())
        .post('/api/v1/calendar-integration/disconnect')
        .expect(401);
    });
  });

  describe('GET /callback — forgery del state (RED first, ruta pública sin guard)', () => {
    it('un state completamente inventado (firmado con secreto incorrecto) nunca crea una conexión', async () => {
      const forgedJwt = new JwtService({
        secret: 'un-secreto-que-el-atacante-inventa',
      });
      const forgedState = forgedJwt.sign({
        sub: therapistAId,
        purpose: 'google-calendar-oauth',
        nonce: 'nonce-inventado-por-el-atacante',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/calendar-integration/callback')
        .query({ code: 'codigo-cualquiera', state: forgedState })
        .expect(302);

      // design.md "Decision: OAuth return path is a module constant pointing
      // at /security" -- el callback debe redirigir a /security (Seguridad,
      // no /settings, que ya no existe como página real tras PR2a) tanto en
      // éxito como en error (account-settings Req: OAuth Redirect Resolution).
      expect(res.headers.location).toContain('/security?calendar=error');

      const connection = await prisma.googleCalendarConnection.findUnique({
        where: { therapistId: therapistAId },
      });
      expect(connection).toBeNull();
    });

    it('un state real con la firma alterada (1 byte corrupto) no muta la conexión existente', async () => {
      const authorize = await request(app.getHttpServer())
        .post('/api/v1/calendar-integration/authorize')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(201);
      const realState = extractStateFromAuthorizeUrl(
        (authorize.body as { url: string }).url,
      );
      // Corrompe el último carácter de la firma del JWT (después del último
      // '.'), sin tocar el payload -- fuerza un fallo de verificación de
      // firma, no de parseo.
      const corruptedState =
        realState.slice(0, -1) + (realState.endsWith('a') ? 'b' : 'a');

      const res = await request(app.getHttpServer())
        .get('/api/v1/calendar-integration/callback')
        .set('Cookie', cookieFrom(authorize))
        .query({ code: 'codigo-cualquiera', state: corruptedState })
        .expect(302);

      expect(res.headers.location).toContain('calendar=error');

      const connection = await prisma.googleCalendarConnection.findUnique({
        where: { therapistId: therapistAId },
      });
      expect(connection?.status).toBe('PENDING');
      expect(connection?.refreshTokenEncrypted).toBeNull();
    });
  });

  describe('GET /callback — replay de un state ya consumido (single-use)', () => {
    it('el primer uso conecta; reenviar el mismo state ya no muta nada', async () => {
      const authorize = await request(app.getHttpServer())
        .post('/api/v1/calendar-integration/authorize')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(201);
      const state = extractStateFromAuthorizeUrl(
        (authorize.body as { url: string }).url,
      );
      const fakeRefreshToken = '1//fake-refresh-token-replay-test';
      stubExchange(fakeRefreshToken);

      const first = await request(app.getHttpServer())
        .get('/api/v1/calendar-integration/callback')
        .set('Cookie', cookieFrom(authorize))
        .query({ code: 'codigo-de-google', state })
        .expect(302);
      // design.md "Decision: OAuth return path is a module constant pointing
      // at /security" -- éxito también aterriza en /security.
      expect(first.headers.location).toContain('/security?calendar=connected');

      const afterFirst = await prisma.googleCalendarConnection.findUnique({
        where: { therapistId: therapistAId },
      });
      expect(afterFirst?.status).toBe('CONNECTED');
      expect(afterFirst?.refreshTokenEncrypted).not.toBeNull();
      expect(
        tokenCrypto
          .decrypt(afterFirst!.refreshTokenEncrypted as Buffer)
          .toString('utf-8'),
      ).toBe(fakeRefreshToken);

      // Replay: mismo `state`, ya consumido -- debe rechazarse sin mutar
      // nada (el nonce ya fue limpiado por el primer uso).
      const replay = await request(app.getHttpServer())
        .get('/api/v1/calendar-integration/callback')
        .set('Cookie', cookieFrom(authorize))
        .query({ code: 'otro-codigo', state })
        .expect(302);
      expect(replay.headers.location).toContain('calendar=error');

      const afterReplay = await prisma.googleCalendarConnection.findUnique({
        where: { therapistId: therapistAId },
      });
      expect(afterReplay?.status).toBe('CONNECTED');
      expect(
        tokenCrypto
          .decrypt(afterReplay!.refreshTokenEncrypted as Buffer)
          .toString('utf-8'),
      ).toBe(fakeRefreshToken);
    });
  });

  // issue #497: reconectar con la conexión activa pisaría el refresh token sin
  // revocar el anterior; hay que desconectar primero.
  describe('POST /authorize — con la conexión CONNECTED', () => {
    it('responde 409 y no toca el token guardado, el nonce ni la cookie', async () => {
      const before = await prisma.googleCalendarConnection.findUnique({
        where: { therapistId: therapistAId },
      });
      expect(before?.status).toBe('CONNECTED');

      const res = await request(app.getHttpServer())
        .post('/api/v1/calendar-integration/authorize')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(409);

      expect((res.body as { message: string }).message).toBe(
        'Desconecta Google Calendar antes de volver a conectarlo',
      );
      expect(res.headers['set-cookie']).toBeUndefined();
      const after = await prisma.googleCalendarConnection.findUnique({
        where: { therapistId: therapistAId },
      });
      expect(after?.status).toBe('CONNECTED');
      expect(after?.refreshTokenEncrypted).toEqual(
        before?.refreshTokenEncrypted,
      );
      expect(after?.stateNonceHash).toBe(before?.stateNonceHash);
    });
  });

  // issue #497: el state solo se puede completar desde el navegador que llamó
  // a /authorize (la cookie con el secreto cuyo hash va en el state).
  describe('GET /callback — state atado al navegador (cookie)', () => {
    it('POST /authorize deja la cookie HttpOnly SameSite=Lax y el secreto no aparece en la URL', async () => {
      await markTherapistADisconnected();
      const authorize = await request(app.getHttpServer())
        .post('/api/v1/calendar-integration/authorize')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(201);

      const setCookie = (
        authorize.headers['set-cookie'] as unknown as string[]
      ).find((c) => c.startsWith('umbral_calendar_oauth='))!;
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      const secret = cookieFrom(authorize).split('=')[1];
      expect((authorize.body as { url: string }).url).not.toContain(secret);
    });

    it('sin la cookie el callback no conecta ni consume el state, que sigue sirviendo en el navegador correcto', async () => {
      await markTherapistADisconnected();
      const authorize = await request(app.getHttpServer())
        .post('/api/v1/calendar-integration/authorize')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(201);
      const state = extractStateFromAuthorizeUrl(
        (authorize.body as { url: string }).url,
      );
      stubExchange('1//token-del-atacante');
      const before = await prisma.googleCalendarConnection.findUnique({
        where: { therapistId: therapistAId },
      });

      const withoutCookie = await request(app.getHttpServer())
        .get('/api/v1/calendar-integration/callback')
        .query({ code: 'codigo-del-atacante', state })
        .expect(302);
      expect(withoutCookie.headers.location).toContain('calendar=error');

      const afterAttack = await prisma.googleCalendarConnection.findUnique({
        where: { therapistId: therapistAId },
      });
      // La conexión quedó tal cual y el nonce no se quemó.
      expect(afterAttack?.status).toBe(before?.status);
      expect(afterAttack?.refreshTokenEncrypted).toEqual(
        before?.refreshTokenEncrypted,
      );
      expect(afterAttack?.stateNonceHash).not.toBeNull();

      const legit = await request(app.getHttpServer())
        .get('/api/v1/calendar-integration/callback')
        .set('Cookie', cookieFrom(authorize))
        .query({ code: 'codigo-legitimo', state })
        .expect(302);
      expect(legit.headers.location).toContain('calendar=connected');
    });

    it('la cookie de otro flujo (otro /authorize) tampoco sirve para este state', async () => {
      // El terapeuta B (sin conexión activa) para no dejar desconectado a A,
      // cuya conexión CONNECTED necesitan los tests de tenencia que siguen.
      const first = await request(app.getHttpServer())
        .post('/api/v1/calendar-integration/authorize')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/api/v1/calendar-integration/authorize')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(201);
      stubExchange('1//token');

      const res = await request(app.getHttpServer())
        .get('/api/v1/calendar-integration/callback')
        .set('Cookie', cookieFrom(second))
        .query({
          code: 'codigo',
          state: extractStateFromAuthorizeUrl(
            (first.body as { url: string }).url,
          ),
        })
        .expect(302);

      expect(res.headers.location).toContain('calendar=error');
    });
  });

  describe('Tenancy — GET /status y POST /disconnect nunca exponen ni mutan la conexión de otro terapeuta', () => {
    it('terapeuta B ve "PENDING" (nunca los datos de la conexión CONNECTED de A)', async () => {
      const status = await request(app.getHttpServer())
        .get('/api/v1/calendar-integration/status')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(200);

      expect((status.body as Record<string, unknown>).status).toBe('PENDING');
      expect(
        (status.body as Record<string, unknown>).googleAccountEmail,
      ).toBeNull();
    });

    it('terapeuta A sí ve su propia conexión CONNECTED', async () => {
      const status = await request(app.getHttpServer())
        .get('/api/v1/calendar-integration/status')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(200);

      expect((status.body as Record<string, unknown>).status).toBe('CONNECTED');
    });

    it('POST /disconnect de terapeuta B nunca desconecta la conexión de A', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/calendar-integration/disconnect')
        .set('Authorization', `Bearer ${therapistBToken}`)
        .expect(404);

      const connectionA = await prisma.googleCalendarConnection.findUnique({
        where: { therapistId: therapistAId },
      });
      expect(connectionA?.status).toBe('CONNECTED');
      expect(connectionA?.refreshTokenEncrypted).not.toBeNull();
    });

    it('el dueño (terapeuta A) sí puede desconectar', async () => {
      jest
        .spyOn(
          oauthService as unknown as {
            buildOAuth2Client: () => {
              revokeToken: (t: string) => Promise<unknown>;
            };
          },
          'buildOAuth2Client',
        )
        .mockReturnValue({ revokeToken: () => Promise.resolve({}) });

      const res = await request(app.getHttpServer())
        .post('/api/v1/calendar-integration/disconnect')
        .set('Authorization', `Bearer ${therapistAToken}`)
        .expect(201);

      expect((res.body as Record<string, unknown>).status).toBe('DISCONNECTED');

      const connectionA = await prisma.googleCalendarConnection.findUnique({
        where: { therapistId: therapistAId },
      });
      expect(connectionA?.status).toBe('DISCONNECTED');
      expect(connectionA?.refreshTokenEncrypted).toBeNull();
    });
  });
});
