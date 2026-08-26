import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../../prisma/prisma.service';
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
}

export interface CalendarConnectionStatus {
  status: string;
  googleAccountEmail: string | null;
  connectedAt: Date | null;
  lastSyncAt: Date | null;
  lastError: string | null;
}

const DEFAULT_STATUS: CalendarConnectionStatus = {
  status: 'PENDING',
  googleAccountEmail: null,
  connectedAt: null,
  lastSyncAt: null,
  lastError: null,
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
        status: true,
        googleAccountEmail: true,
        connectedAt: true,
        lastSyncAt: true,
        lastError: true,
      },
    });

    return connection ?? DEFAULT_STATUS;
  }

  async buildAuthorizationUrl(therapistId: string): Promise<{ url: string }> {
    this.assertEnabled();

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
      { sub: therapistId, purpose: OAUTH_STATE_PURPOSE, nonce },
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

    return { url };
  }

  // design.md: firma+exp+purpose ya los valida jwtService.verify (lanza si
  // cualquiera falla); el nonce hash se compara y se limpia en una única
  // operación atómica (updateMany con match en el WHERE, mismo patrón de
  // "claim" que RemindersService.claimAndDispatch) -- así una segunda
  // llamada concurrente con el mismo `state` (replay) nunca puede ganar la
  // carrera contra la primera.
  async verifyAndConsumeState(state: string): Promise<{ therapistId: string }> {
    let payload: OAuthStatePayload;
    try {
      payload = this.jwtService.verify<OAuthStatePayload>(state);
    } catch {
      throw new UnauthorizedException('state inválido o expirado');
    }

    if (payload.purpose !== OAUTH_STATE_PURPOSE) {
      throw new UnauthorizedException('state inválido');
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
      const refreshToken = this.tokenCrypto
        .decrypt(connection.refreshTokenEncrypted as Buffer)
        .toString('utf-8');
      try {
        await this.buildOAuth2Client().revokeToken(refreshToken);
      } catch (err) {
        // La revocación en Google es best-effort: el token local se borra
        // igual más abajo (proposal.md "Disconnect: Call Google's revoke
        // endpoint, then delete the stored token") -- si Google ya lo
        // invalidó por su cuenta, revoke devuelve error pero el objetivo
        // (que Umbral deje de tener un token utilizable) se cumple igual.
        this.logger.error(
          `Fallo al revocar el token en Google para therapistId=${therapistId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return this.prisma.googleCalendarConnection.update({
      where: { therapistId },
      data: {
        status: 'DISCONNECTED',
        disconnectReason: 'USER_REQUEST',
        disconnectedAt: new Date(),
        refreshTokenEncrypted: null,
        scope: null,
      },
      select: { status: true },
    });
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

    return { refreshToken: tokens.refresh_token, scope: tokens.scope };
  }
}
