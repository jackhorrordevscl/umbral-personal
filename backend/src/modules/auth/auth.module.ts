import { Logger, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerModuleOptions } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * Config de los throttlers de auth (T4.2, issue #20; hallazgo de code
 * review sobre PR #39: mfa/verify tenía su propio guard pero compartía el
 * mismo par de env vars que login, así que subir el límite de login por
 * error también relajaba el presupuesto de fuerza bruta sobre el TOTP).
 *
 * Dos throttlers nombrados e independientes:
 * - 'login': LOGIN_THROTTLE_LIMIT intentos por LOGIN_THROTTLE_TTL_MS ms
 *   (default 5 / 60000ms), para POST /auth/login.
 * - 'mfa-verify': MFA_THROTTLE_LIMIT intentos por MFA_THROTTLE_TTL_MS ms
 *   (mismos defaults), para POST /auth/mfa/verify.
 *
 * @nestjs/throttler aplica POR DEFECTO todos los throttlers registrados a
 * toda ruta con @UseGuards(ThrottlerGuard) — por eso cada ruta en
 * auth.controller.ts usa @SkipThrottle() para saltar el throttler que no le
 * corresponde; sin eso, login también consumiría cupo del throttler
 * 'mfa-verify' (y viceversa) además del propio.
 *
 * Jest setea NODE_ENV=test automáticamente en toda corrida de test, sin que
 * nadie tenga que configurarlo. Cuando corremos ahí Y las env vars de arriba
 * NO fueron seteadas explícitamente, usamos un límite mucho más alto (1000)
 * para no romper las suites e2e existentes, que loguean varias veces por
 * corrida contra la misma AppModule compilada. Si alguien setea las env
 * vars explícitamente (incluso en test), se respetan tal cual — así es como
 * rate-limit-login.e2e-spec.ts prueba el 429 real, vía override de DI del
 * token de opciones del ThrottlerModule, sin tocar esta rama.
 */
// Un valor no numérico en la env var (typo, string vacío) no debe apagar el
// throttler en silencio: Number('') es 0 y Number('abc') es NaN, y ambos
// harían que la comparación totalHits > limit de @nestjs/throttler nunca
// bloquee. Si el valor no parsea a un entero positivo, se ignora y se usa
// el default.
function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// Sin esto, ThrottlerGuard usaría su tracker por defecto (req.ip), que sin
// `trust proxy` configurado en Express resuelve a la IP del proxy para TODAS
// las conexiones — colapsando el límite de login en un único bucket global
// compartido por todos los usuarios, donde cualquiera podría agotarlo y
// bloquear el login de todo el mundo con 429. En vez de tocar la config
// global de Express en main.ts (que afectaría a cualquier otro consumidor
// de req.ip en la app, ej. AuditLog.ipAddress), esto queda acotado al
// throttler de login.
//
// X-Forwarded-For es una lista que cada proxy AGREGA al final, no reemplaza:
// el primer valor lo pone el cliente (así que es trivialmente falsificable
// por cualquiera que arme el request a mano), y cada proxy confiable que
// sigue agrega la IP de quien se conectó DIRECTO a él. El valor que
// necesitamos es el que agregó el proxy MÁS EXTERNO de nuestra infra
// confiable (el primero que ve la conexión real del cliente y no confía en
// lo que el cliente le mande) — no necesariamente "el último" de la lista,
// eso depende de cuántos proxies confiables haya delante.
//
// TRUSTED_PROXY_HOPS = cantidad de proxies confiables delante de la app.
// Con un único proxy de edge (PaaS sin CDN delante) es 1: el único valor de
// la lista es directamente la IP real, así que "el último" == "el único" ==
// el correcto.
// Con Render detrás de Cloudflare (el deploy actual, verificado en un deploy
// real, T4.2 follow-up) son 3: Cloudflare agrega la IP real del cliente (no
// confía en lo que el cliente le mande, así que ese valor no se puede spoofear), y
// después el ingress + el ruteo interno de Render agregan un hop cada uno.
// Con TRUSTED_PROXY_HOPS=3 sobre esa lista de 3 valores, el índice
// resultante es 0 — el que agregó Cloudflare. Si algún día cambia la
// cantidad de saltos internos de Render, se ajusta la env var sin tocar
// código.
//
// Si la lista tiene menos valores de los esperados (headers.length < hops
// esperados) se usa el primer valor como fallback en vez de un índice
// negativo — más seguro que reventar. OJO: esto asume que la cantidad real
// de proxies confiables delante nunca es MENOR a TRUSTED_PROXY_HOPS — si el
// origin de Render fuera alcanzable directo (bypaseando Cloudflare), un
// atacante podría mandar una lista más corta con contenido propio y
// controlar qué valor cae en el índice esperado. Este código no puede
// blindar contra eso por sí solo; requiere que la infra (Render/Cloudflare)
// efectivamente bloquee el acceso directo al origin.
export function getLoginTracker(
  req: {
    headers: Record<string, string | string[] | undefined>;
    ip: string;
  },
  trustedProxyHops = 1,
): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwardedFor)
    ? forwardedFor.join(',')
    : forwardedFor;
  if (typeof raw === 'string') {
    const hops = raw
      .split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    if (hops.length > 0) {
      const index = hops.length - trustedProxyHops;
      return hops[index >= 0 ? index : 0];
    }
  }
  return req.ip;
}

export function buildAuthThrottlerOptions(
  config: ConfigService,
): ThrottlerModuleOptions {
  const isTest = config.get<string>('NODE_ENV') === 'test';

  const loginLimit = parsePositiveInt(
    config.get<string>('LOGIN_THROTTLE_LIMIT'),
    isTest ? 1000 : 5,
  );
  const loginTtl = parsePositiveInt(
    config.get<string>('LOGIN_THROTTLE_TTL_MS'),
    60000,
  );

  const mfaVerifyLimit = parsePositiveInt(
    config.get<string>('MFA_THROTTLE_LIMIT'),
    isTest ? 1000 : 5,
  );
  const mfaVerifyTtl = parsePositiveInt(
    config.get<string>('MFA_THROTTLE_TTL_MS'),
    60000,
  );

  const trustedProxyHops = parsePositiveInt(
    config.get<string>('TRUSTED_PROXY_HOPS'),
    1,
  );

  return {
    throttlers: [
      { name: 'login', limit: loginLimit, ttl: loginTtl },
      { name: 'mfa-verify', limit: mfaVerifyLimit, ttl: mfaVerifyTtl },
    ],
    getTracker: (req: Record<string, any>) =>
      getLoginTracker(req as Parameters<typeof getLoginTracker>[0], trustedProxyHops),
  };
}

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') as string,
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '8h') },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: buildAuthThrottlerOptions,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
