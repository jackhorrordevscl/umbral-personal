import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GoogleTokenCryptoService } from './google-token-crypto.service';
import {
  GOOGLE_CALENDAR_SCOPE,
  OAUTH_STATE_PURPOSE,
  STATE_TTL_MS,
} from './calendar-integration.constants';

interface OAuthStatePayload {
  sub: string;
  purpose: string;
  nonce: string;
  // issue #497: sha256 del secreto de la cookie del navegador que inició el
  // flujo (ver calendar-oauth-cookie.ts). El secreto en sí nunca va en el state.
  bind?: string;
}

export interface CalendarConnectionStatus {
  status: string;
  googleAccountEmail: string | null;
  connectedAt: Date | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  // issue #497: lo que hoy solo queda en los logs. Cantidad de eventos que no se
  // pudieron subir a Google y si falló el último refresco de ocupación; el
  // texto del error no sale del backend.
  failedEvents: number;
  busySyncFailed: boolean;
}

// googleAccountEmail queda siempre null: el scope pedido es solo `calendar.events`
// (sin `openid`/`email`), así que Umbral no puede saber qué cuenta de Google se
// conectó. Por eso no se purgan los vínculos al reconectar otra cuenta (issue #427).
const DEFAULT_STATUS: CalendarConnectionStatus = {
  status: 'PENDING',
  googleAccountEmail: null,
  connectedAt: null,
  lastSyncAt: null,
  lastError: null,
  failedEvents: 0,
  busySyncFailed: false,
};

// design.md "The OAuth callback is unauthenticated; identity travels in a
// signed, single-use state" + "The access token is never persisted" +
// "Dedicated GOOGLE_TOKEN_ENCRYPTION_KEY, not DOCUMENT_ENCRYPTION_KEY":
// dueño del handshake OAuth completo (authorize/callback/disconnect) y de la
// custodia cifrada del refresh token. La propagación de eventos
// (CalendarSyncService) es un servicio aparte, implementado en PR 2.
@Injectable()
export class CalendarOauthService {
  private readonly logger = new Logger(CalendarOauthService.name);
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly redirectUri?: string;
  private readonly enabled: boolean;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private tokenCrypto: GoogleTokenCryptoService,
    private auditService: AuditService,
  ) {
    this.clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    this.clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    this.redirectUri = this.config.get<string>('GOOGLE_REDIRECT_URI');
    this.enabled = Boolean(this.clientId && this.clientSecret);

    // Mismo criterio que MailService sin RESEND_API_KEY (mail.service.ts):
    // sin credenciales de Google, el módulo se registra pero no-opea con un
    // warning -- no bloquea el arranque en dev/test/CI (design.md "Migration
    // / Rollout").
    if (!this.enabled) {
      this.logger.warn(
        'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET no configuradas: la integración con Google Calendar queda deshabilitada.',
      );
    }
  }

  async getStatus(therapistId: string): Promise<CalendarConnectionStatus> {
    const connection = await this.prisma.googleCalendarConnection.findUnique({
      where: { therapistId },
      select: {
        id: true,
        status: true,
        googleAccountEmail: true,
        connectedAt: true,
        lastSyncAt: true,
        lastError: true,
        busySyncError: true,
      },
    });

    if (!connection) return DEFAULT_STATUS;

    // Solo una conexión activa tiene sincronización que mostrar: al desconectar
    // se pierden las advertencias de una sincronización que ya no corre.
    const connected = connection.status === 'CONNECTED';
    const failedEvents = connected
      ? await this.prisma.calendarEventLink.count({
          where: { connectionId: connection.id, syncStatus: 'FAILED' },
        })
      : 0;

    return {
      status: connection.status,
      googleAccountEmail: connection.googleAccountEmail,
      connectedAt: connection.connectedAt,
      lastSyncAt: connection.lastSyncAt,
      lastError: connection.lastError,
      failedEvents,
      busySyncFailed: connected && connection.busySyncError !== null,
    };
  }

  // `bindingToken` lo debe dejar el controller en la cookie del navegador; el
  // callback lo exige de vuelta (verifyAndConsumeState).
  async buildAuthorizationUrl(
    therapistId: string,
  ): Promise<{ url: string; bindingToken: string }> {
    this.assertEnabled();

    const bindingToken = randomBytes(32).toString('hex');
    const nonce = randomBytes(16).toString('hex');
    const nonceHash = this.hashNonce(nonce);
    const stateExpiresAt = new Date(Date.now() + STATE_TTL_MS);

    // Upsert (no create-only): reconectar después de un disconnect, o
    // reintentar un /authorize antes de completar el anterior, reutiliza la
    // misma fila -- @unique(therapistId) es la garantía de "una conexión por
    // terapeuta" (proposal.md "Granularity").
    await this.prisma.googleCalendarConnection.upsert({
      where: { therapistId },
      create: {
        therapistId,
        stateNonceHash: nonceHash,
        stateExpiresAt,
      },
      update: {
        stateNonceHash: nonceHash,
        stateExpiresAt,
      },
    });

    const state = this.jwtService.sign(
      {
        sub: therapistId,
        purpose: OAUTH_STATE_PURPOSE,
        nonce,
        bind: this.hashNonce(bindingToken),
      },
      { expiresIn: `${Math.floor(STATE_TTL_MS / 1000)}s` },
    );

    const url = this.buildOAuth2Client().generateAuthUrl({
      access_type: 'offline',
      scope: [GOOGLE_CALENDAR_SCOPE],
      // Sin esto, Google solo devuelve refresh_token la PRIMERA vez que un
      // usuario da consentimiento a esta app -- una reconexión posterior
      // (tras un disconnect, o tras revocar manualmente desde su cuenta de
      // Google) devolvería tokens sin refresh_token, dejando la conexión
      // inutilizable (ver exchangeAuthorizationCode).
      prompt: 'consent',
      state,
    });

    return { url, bindingToken };
  }

  // design.md: firma+exp+purpose ya los valida jwtService.verify (lanza si
  // cualquiera falla); el nonce hash se compara y se limpia en una única
  // operación atómica (updateMany con match en el WHERE, mismo patrón de
  // "claim" que RemindersService.claimAndDispatch) -- así una segunda
  // llamada concurrente con el mismo `state` (replay) nunca puede ganar la
  // carrera contra la primera.
  //
  // issue #497: además exige que el navegador que vuelve sea el que inició el
  // flujo (`bindingToken` es el valor de la cookie). Se comprueba ANTES de
  // consumir el nonce, para que quien solo tenga el state no pueda quemarlo.
  async verifyAndConsumeState(
    state: string,
    bindingToken: string | undefined,
  ): Promise<{ therapistId: string }> {
    let payload: OAuthStatePayload;
    try {
      payload = this.jwtService.verify<OAuthStatePayload>(state);
    } catch {
      throw new UnauthorizedException('state inválido o expirado');
    }

    if (payload.purpose !== OAUTH_STATE_PURPOSE) {
      throw new UnauthorizedException('state inválido');
    }

    if (
      !bindingToken ||
      typeof payload.bind !== 'string' ||
      !this.safeEqualHex(this.hashNonce(bindingToken), payload.bind)
    ) {
      throw new UnauthorizedException('state no corresponde a este navegador');
    }

    const nonceHash = this.hashNonce(payload.nonce);
    const result = await this.prisma.googleCalendarConnection.updateMany({
      where: {
        therapistId: payload.sub,
        stateNonceHash: nonceHash,
        stateExpiresAt: { gt: new Date() },
      },
      data: { stateNonceHash: null, stateExpiresAt: null },
    });

    if (result.count === 0) {
      throw new UnauthorizedException('state inválido o ya utilizado');
    }

    return { therapistId: payload.sub };
  }

  async exchangeCodeAndPersist(
    therapistId: string,
    code: string,
  ): Promise<void> {
    const { refreshToken, scope } = await this.exchangeAuthorizationCode(code);
    const encrypted = this.tokenCrypto.encrypt(
      Buffer.from(refreshToken, 'utf-8'),
    );

    await this.prisma.googleCalendarConnection.update({
      where: { therapistId },
      data: {
        status: 'CONNECTED',
        // Prisma tipa "Bytes" como Uint8Array<ArrayBuffer>; Buffer.buffer es
        // ArrayBufferLike (incluye SharedArrayBuffer), así que TS lo rechaza
        // directo -- Uint8Array.from copia a un ArrayBuffer real.
        refreshTokenEncrypted: Uint8Array.from(encrypted),
        scope,
        connectedAt: new Date(),
        disconnectReason: null,
        disconnectedAt: null,
        lastError: null,
      },
    });

    // issue #119: conectar una cuenta de terceros (agenda del terapeuta) es
    // comparablemente sensible a MFA_ENABLED -- mismo criterio de
    // AuditService que auth.service.ts.
    await this.auditService.log({
      userId: therapistId,
      action: 'CALENDAR_CONNECTED',
      resource: 'GoogleCalendarConnection',
      resourceId: therapistId,
    });
  }

  async disconnect(therapistId: string): Promise<{ status: string }> {
    const connection = await this.prisma.googleCalendarConnection.findUnique({
      where: { therapistId },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new NotFoundException(
        'No hay una conexión activa de Google Calendar',
      );
    }

    if (connection.refreshTokenEncrypted) {
      try {
        const refreshToken = this.tokenCrypto
          .decrypt(connection.refreshTokenEncrypted as Buffer)
          .toString('utf-8');
        await this.buildOAuth2Client().revokeToken(refreshToken);
      } catch (err) {
        // La revocación en Google es best-effort: el token local se borra
        // igual más abajo (proposal.md "Disconnect: Call Google's revoke
        // endpoint, then delete the stored token") -- si Google ya lo
        // invalidó por su cuenta, revoke devuelve error pero el objetivo
        // (que Umbral deje de tener un token utilizable) se cumple igual.
        // issue #497: el descifrado va dentro del try. Con una clave rotada o
        // un dato corrupto no se puede revocar, pero tampoco debe impedirse
        // la desconexión: si no, el terapeuta queda sin salida y el token
        // cifrado sigue guardado.
        this.logger.error(
          `Fallo al revocar el token en Google para therapistId=${therapistId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const updated = await this.prisma.googleCalendarConnection.update({
      where: { therapistId },
      data: {
        status: 'DISCONNECTED',
        disconnectReason: 'USER_REQUEST',
        disconnectedAt: new Date(),
        refreshTokenEncrypted: null,
        scope: null,
        // issue #283: invalida el overlay en la misma escritura; si el
        // terapeuta reconecta enseguida, no se confía en bloques viejos.
        busySyncedAt: null,
      },
      select: { status: true },
    });

    // issue #283: los intervalos ocupados de Google dejan de ser válidos al
    // desconectar. Higiene, no correctitud (busySyncedAt ya los invalida), así
    // que un fallo se registra sin romper la desconexión ya hecha.
    await this.prisma.calendarBusyBlock
      .deleteMany({ where: { therapistId } })
      .catch((err: unknown) => {
        this.logger.error(
          `Fallo al borrar CalendarBusyBlock para therapistId=${therapistId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    // issue #119: desconexión pedida por el propio terapeuta -- la
    // desconexión por invalid_grant (CalendarSyncService.handleInvalidGrant)
    // audita aparte, no pasa por acá.
    await this.auditService.log({
      userId: therapistId,
      action: 'CALENDAR_DISCONNECTED',
      resource: 'GoogleCalendarConnection',
      resourceId: therapistId,
      detail: 'USER_REQUEST',
    });

    return updated;
  }

  // Comparación en tiempo constante de dos digests hex (sha256: largo fijo).
  private safeEqualHex(a: string, b: string): boolean {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private hashNonce(nonce: string): string {
    return createHash('sha256').update(nonce).digest('hex');
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'La integración con Google Calendar no está configurada.',
      );
    }
  }

  private buildOAuth2Client(): OAuth2Client {
    return new OAuth2Client({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      redirectUri: this.redirectUri,
    });
  }

  // Separado del resto de exchangeCodeAndPersist para que los tests puedan
  // interceptar solo esta llamada de red real a Google (jest.spyOn), sin
  // mockear todo google-auth-library.
  private async exchangeAuthorizationCode(
    code: string,
  ): Promise<{ refreshToken: string; scope?: string }> {
    this.assertEnabled();
    const { tokens } = await this.buildOAuth2Client().getToken(code);

    if (!tokens.refresh_token) {
      throw new UnauthorizedException(
        'Google no devolvió un refresh_token (revisa access_type=offline y prompt=consent).',
      );
    }

    // issue #497: con consentimiento granular el usuario puede desmarcar el
    // permiso de calendario y Google igual devuelve un refresh_token. Conectar
    // así dejaría la conexión CONNECTED con todas las llamadas en 403
    // (clasificadas transient) y la UI mostrando una integración sana. Se
    // rechaza antes de persistir. No se revoca el token recién emitido: el
    // único scope que se pide es el de calendario, así que sin él el token no
    // da acceso a nada, y revocarlo puede invalidar el grant completo de un
    // terapeuta que ya tenía una conexión vigente y solo reintentó el flujo.
    if (!this.hasCalendarScope(tokens.scope)) {
      throw new UnauthorizedException(
        'Google no concedió el permiso de calendario: vuelve a conectar y deja marcado el acceso a tu calendario.',
      );
    }

    return { refreshToken: tokens.refresh_token, scope: tokens.scope };
  }

  // `scope` llega como lista separada por espacios (RFC 6749 §3.3).
  private hasCalendarScope(scope: string | undefined): boolean {
    return (scope ?? '').split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE);
  }
}
