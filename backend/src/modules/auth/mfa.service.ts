import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { MfaSecretCryptoService } from './mfa-secret-crypto.service';
import { normalizeEmail } from '../../common/utils/normalize-email.util';
import { maskEmail } from '../../common/utils/mask-email.util';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { MfaRecoverDto } from './dto/mfa-recover.dto';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import { getDummyPasswordHash } from './dummy-password-hash.util';
import { logAuditFailOpen } from '../../common/utils/audit-fail-open.util';

// Purpose que llevan los JWT de corta duración emitidos para forzar el
// enrolamiento MFA. Nunca deben aceptarse como sesión (ver jwt.strategy.ts).
// Se exporta porque AuthService.completeLogin() sigue necesitando esta
// constante para FIRMAR el setupToken que después consume MfaService.
export const MFA_SETUP_PURPOSE = 'mfa-setup';

// Issue #302: purpose del JWT de 5 min que emite completeLogin() tras el paso
// de contraseña y que POST /auth/mfa/verify exige en lugar de un userId crudo.
// Tampoco se acepta como sesión (ver jwt.strategy.ts).
export const MFA_VERIFY_PURPOSE = 'mfa-verify';

// Duración de un paso TOTP (RFC 6238, default de speakeasy).
const TOTP_STEP_SECONDS = 30;

// Issue #50: cantidad de códigos de recuperación de MFA generados por
// enableMfa. 10 es el estándar de facto (GitHub, Google) -- suficiente para
// varios extravíos del dispositivo TOTP sin ser tantos que degrade la
// seguridad de tenerlos impresos/guardados.
const MFA_RECOVERY_CODES_COUNT = 10;

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private auditService: AuditService,
    private mfaSecretCrypto: MfaSecretCryptoService,
    private mailService: MailService,
  ) {}

  /**
   * Issue #302: mfaSecret is stored encrypted at rest. Returns the plaintext
   * base32 secret, or null when the stored value cannot be decrypted
   * (tampered, or encrypted under another key) so callers reject the request
   * like any invalid code instead of surfacing a 500.
   */
  private revealSecret(userId: string, stored: string): string | null {
    try {
      return this.mfaSecretCrypto.decrypt(stored);
    } catch {
      this.logger.error(
        `No se pudo descifrar el mfaSecret del usuario ${userId}: valor alterado o clave distinta.`,
      );
      return null;
    }
  }

  /**
   * Issue #302: rows written before the encryption at rest hold the base32
   * secret in plaintext. They keep working (decrypt passes them through) and
   * are re-encrypted lazily on the first successful TOTP. The conditional
   * updateMany makes it a no-op if the secret changed concurrently, and a
   * failure here never blocks the login (the secret is still valid as is).
   */
  private async reencryptLegacySecret(
    userId: string,
    stored: string,
    plaintext: string,
  ): Promise<void> {
    if (this.mfaSecretCrypto.isEncrypted(stored)) return;
    try {
      await this.prisma.user.updateMany({
        where: { id: userId, mfaSecret: stored },
        data: { mfaSecret: this.mfaSecretCrypto.encrypt(plaintext) },
      });
    } catch (error) {
      this.logger.error(
        `No se pudo re-cifrar el mfaSecret legado del usuario ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Enrolamiento MFA forzado (paso 1) para cualquier cuenta sin MFA
   * configurado -- MFA es obligatorio para toda cuenta, no solo para un rol
   * en particular (ver completeLogin más abajo).
   * Recibe el setupToken de corta duración emitido por login(), nunca un
   * userId crudo. Reusa generateMfaSecret, que ya hace exactamente lo que
   * necesitamos: busca el user, genera+persiste el secreto TOTP y devuelve
   * el QR.
   */
  async beginMfaSetup(setupToken: string) {
    const payload = this.verifySetupToken(setupToken);
    await this.rejectIfAlreadyEnrolled(payload.sub);
    return this.generateMfaSecret(payload.sub);
  }

  /**
   * Enrolamiento MFA forzado (paso 2). Verifica el TOTP contra el secreto
   * generado en beginMfaSetup reusando enableMfa (que ya valida el token y
   * marca mfaEnabled=true), y si es válido loguea al usuario devolviendo un
   * accessToken real — el enrolamiento forzado termina la sesión, no solo
   * activa MFA.
   */
  async confirmMfaSetup(
    setupToken: string,
    token: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const payload = this.verifySetupToken(setupToken);
    await this.rejectIfAlreadyEnrolled(payload.sub);
    const { recoveryCodes } = await this.enableMfa(
      payload.sub,
      token,
      ipAddress,
      userAgent,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) throw new UnauthorizedException('Usuario no válido');

    return {
      ...(await this.generateToken(user, ipAddress, userAgent)),
      recoveryCodes,
    };
  }

  /**
   * Verifica un setupToken de enrolamiento MFA forzado: firma válida, no
   * expirado, y purpose === 'mfa-setup'. Es la única puerta de entrada para
   * beginMfaSetup/confirmMfaSetup; jwt.strategy.ts además impide que este
   * mismo token se use como Bearer token de sesión en cualquier otra ruta.
   */
  private verifySetupToken(setupToken: string): {
    sub: string;
    purpose?: string;
  } {
    let payload: { sub: string; purpose?: string };
    try {
      payload = this.jwtService.verify(setupToken);
    } catch {
      throw new UnauthorizedException(
        'Token de configuración MFA inválido o expirado',
      );
    }

    if (payload.purpose !== MFA_SETUP_PURPOSE) {
      throw new UnauthorizedException('Token de configuración MFA inválido');
    }

    return payload;
  }

  /**
   * Un setupToken no tiene marca de "ya usado": es un JWT sin estado, válido
   * hasta que expira (10 min). Si no chequeáramos esto, un setupToken filtrado
   * (logs, proxies, etc.) seguiría sirviendo para regenerar el secreto TOTP y
   * tomar la cuenta con generateToken aunque el enrolamiento legítimo ya
   * hubiera terminado. Cortamos ese replay apenas mfaEnabled pasa a true.
   */
  private async rejectIfAlreadyEnrolled(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.mfaEnabled) {
      throw new UnauthorizedException(
        'MFA ya fue configurado para esta cuenta',
      );
    }
  }

  /**
   * Verifica el mfaToken emitido por completeLogin(): firma válida, no
   * expirado y purpose === 'mfa-verify'. Prueba que el paso de contraseña se
   * completó; sin él mfa/verify no acepta ningún TOTP.
   */
  private verifyMfaToken(mfaToken: string): { sub: string } {
    let payload: { sub: string; purpose?: string };
    try {
      payload = this.jwtService.verify(mfaToken);
    } catch {
      throw new UnauthorizedException('Código MFA inválido');
    }

    if (payload.purpose !== MFA_VERIFY_PURPOSE || !payload.sub) {
      throw new UnauthorizedException('Código MFA inválido');
    }

    return payload;
  }

  /**
   * Issue #302: valida un TOTP y consume su paso de forma atómica. Un mismo
   * paso no puede aceptarse dos veces para el mismo usuario (replay): el
   * updateMany condicional solo avanza lastUsedStep si el paso es mayor, y si
   * otra petición concurrente ya lo consumió, count === 0.
   */
  private async consumeTotp(
    userId: string,
    secret: string,
    token: string,
  ): Promise<boolean> {
    const delta = speakeasy.totp.verifyDelta({
      secret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!delta) return false;

    const step =
      Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + delta.delta;

    const { count } = await this.prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }],
      },
      data: { lastUsedStep: step },
    });

    return count > 0;
  }

  async verifyMfa(dto: VerifyMfaDto, ipAddress?: string, userAgent?: string) {
    const { sub: userId } = this.verifyMfaToken(dto.mfaToken);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    // El mfaToken se firmó antes de este paso, así que la cuenta pudo
    // desactivarse o perder MFA en el intervalo (ej. offboarding de un
    // colaborador comprometido, recover): se revalidan deletedAt y mfaEnabled.
    // Solo con mfaEnabled se acepta el TOTP -- un secreto pendiente de
    // enrolamiento (mfaEnabled=false) no debe servir para obtener sesión.
    // Mismo mensaje que un TOTP incorrecto para no revelar el estado.
    if (!user || !user.mfaEnabled || !user.mfaSecret || user.deletedAt) {
      throw new UnauthorizedException('Código MFA inválido');
    }

    const secret = this.revealSecret(user.id, user.mfaSecret);
    if (!secret) {
      throw new UnauthorizedException('Código MFA inválido');
    }

    const isValid = await this.consumeTotp(user.id, secret, dto.token);

    if (!isValid) {
      // Sin await: no suma latencia a la respuesta de rechazo (fail-open).
      void logAuditFailOpen(this.auditService, this.logger, {
        userId: user.id,
        action: 'MFA_FAILED',
        resource: 'MFA',
        resourceId: user.id,
        detail: 'Código TOTP inválido',
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Código MFA inválido');
    }

    await this.reencryptLegacySecret(user.id, user.mfaSecret, secret);

    // Mismo criterio que login(): ningún accessToken se emite mientras la
    // contraseña deba cambiarse. Se chequea recién con el TOTP válido para no
    // revelar este estado a quien solo conoce un userId. Sin esto, una cuenta
    // con MFA activo y cambio forzado pendiente podría saltarse el cambio
    // logueando solo con el TOTP.
    if (user.mustChangePassword) {
      throw new UnauthorizedException(
        'Debes cambiar tu contraseña antes de iniciar sesión',
      );
    }

    return this.generateToken(user, ipAddress, userAgent);
  }

  async generateMfaSecret(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Usuario no válido');

    // Si MFA ya está activo, regenerar el secreto acá (con solo un
    // accessToken válido, sin probar el TOTP actual) le rompería el
    // autenticador al dueño legítimo sin aviso y le abriría la puerta a
    // quien haya robado el token de sesión a tomar el segundo factor.
    // Mismo criterio que disableMfa: para tocar un MFA ya activo hace falta
    // el TOTP vigente, no solo una sesión.
    if (user.mfaEnabled) {
      throw new UnauthorizedException(
        'MFA ya está activo. Desactívalo primero para regenerar el secreto.',
      );
    }

    const secret = speakeasy.generateSecret({
      name: `Umbral - RCE (${user.email})`,
      length: 20,
    });

    // Guarda el secreto temporalmente (aún no activa MFA)
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaSecret: this.mfaSecretCrypto.encrypt(secret.base32),
        lastUsedStep: null,
      },
    });

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url!);

    return {
      secret: secret.base32,
      qrCode: qrCodeUrl,
    };
  }

  async enableMfa(
    userId: string,
    token: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaSecret) {
      throw new UnauthorizedException('Primero genera el secreto MFA');
    }

    const secret = this.revealSecret(userId, user.mfaSecret);
    if (!secret) {
      throw new UnauthorizedException('Primero genera el secreto MFA');
    }

    const isValid = await this.consumeTotp(userId, secret, token);

    if (!isValid) {
      throw new UnauthorizedException('Código inválido, intenta de nuevo');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    // Issue #50: se generan acá (no en un endpoint separado) porque este es
    // el único momento en que sabemos que el usuario probó control real del
    // dispositivo TOTP -- mismo motivo por el que confirmMfaSetup reusa este
    // método en vez de duplicar la lógica de habilitación.
    const recoveryCodes = await this.generateAndPersistRecoveryCodes(userId);
    await this.auditService.log({
      userId,
      action: 'MFA_RECOVERY_CODES_GENERATED',
      resource: 'User',
      resourceId: userId,
    });
    // Compliance: registro explícito de cuándo y desde qué dispositivo se
    // activó MFA (cubre tanto el enrolamiento forzado de confirmMfaSetup
    // como una reactivación voluntaria posterior a un disableMfa) -- antes
    // de esto, el único rastro era el genérico que deja AuditInterceptor
    // (action CREATE, sin distinguir MFA de cualquier otro POST) y no
    // llegaba a ejecutarse en mfa/setup/confirm por no llevar JwtAuthGuard.
    await this.auditService.log({
      userId,
      action: 'MFA_ENABLED',
      resource: 'User',
      resourceId: userId,
      ipAddress,
      userAgent,
    });

    return { message: 'MFA activado correctamente', recoveryCodes };
  }

  async disableMfa(
    userId: string,
    token: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaSecret) {
      throw new UnauthorizedException('MFA no está configurado');
    }

    const secret = this.revealSecret(userId, user.mfaSecret);
    if (!secret) {
      throw new UnauthorizedException('Código inválido');
    }

    const isValid = await this.consumeTotp(userId, secret, token);

    if (!isValid) {
      throw new UnauthorizedException('Código inválido');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null, lastUsedStep: null },
    });

    // Compliance: mismo criterio que enableMfa -- registro explícito con
    // ip/user-agent de la desactivación voluntaria (distinto de
    // MFA_DISABLED_VIA_RECOVERY, que ya lo tenía).
    await this.auditService.log({
      userId,
      action: 'MFA_DISABLED',
      resource: 'User',
      resourceId: userId,
      ipAddress,
      userAgent,
    });

    return { message: 'MFA desactivado correctamente' };
  }

  /**
   * Issue #50: círculo cerrado que dejaba disableMfa (arriba) sin salida --
   * exigía un TOTP válido del mismo secreto, así que perder el dispositivo
   * MFA bloqueaba la cuenta sin acceso manual a la base de datos. Exige
   * password (no solo el código de recuperación) a propósito: un recovery
   * code filtrado por sí solo no debe bastar para tomar el segundo factor de
   * una cuenta, mismo nivel de defensa en profundidad que login().
   *
   * Mismo mensaje 401 genérico que login() si el email/password no matchean,
   * para no filtrar qué cuentas existen. Una vez usado, MFA queda
   * deshabilitado -- reusar otro código sobrante de la misma tanda falla
   * limpio en el chequeo de mfaEnabled de más abajo, sin necesidad de borrar
   * el resto (enableMfa los reemplaza igual la próxima vez que se habilite).
   */
  async recoverMfa(dto: MfaRecoverDto, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(dto.email) },
    });
    if (!user || user.deletedAt) {
      await argon2.verify(await getDummyPasswordHash(), dto.password);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      void logAuditFailOpen(this.auditService, this.logger, {
        userId: user.id,
        action: 'LOGIN_FAILED',
        resource: 'MFA',
        resourceId: user.id,
        detail: 'Contraseña incorrecta en la recuperación de MFA',
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!user.mfaEnabled) {
      throw new UnauthorizedException('MFA no está configurado');
    }

    // Los códigos se guardan hasheados (igual que passwordHash): no hay
    // forma de buscarlos por igualdad directa, así que se recorren los no
    // usados y se verifica cada hash contra el código recibido. La tanda es
    // acotada (MFA_RECOVERY_CODES_COUNT), sin impacto de performance real.
    const unusedCodes = await this.prisma.mfaRecoveryCode.findMany({
      where: { userId: user.id, usedAt: null },
    });

    let matchedCodeId: string | null = null;
    for (const candidate of unusedCodes) {
      if (await argon2.verify(candidate.codeHash, dto.recoveryCode)) {
        matchedCodeId = candidate.id;
        break;
      }
    }

    if (!matchedCodeId) {
      void logAuditFailOpen(this.auditService, this.logger, {
        userId: user.id,
        action: 'MFA_FAILED',
        resource: 'MFA',
        resourceId: user.id,
        detail: 'Código de recuperación inválido',
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Código de recuperación inválido');
    }

    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.update({
        where: { id: matchedCodeId },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { mfaEnabled: false, mfaSecret: null, lastUsedStep: null },
      }),
      // Issue #302: whoever holds the recovery code + password may not be the
      // owner, so every session opened before the recovery dies with it. In
      // the same transaction so MFA is never off while old sessions live.
      this.prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditService.log({
      userId: user.id,
      action: 'MFA_DISABLED_VIA_RECOVERY',
      resource: 'User',
      resourceId: user.id,
      ipAddress,
      userAgent,
    });

    // Best effort: MailService never throws on provider errors, and anything
    // unexpected must not undo a recovery that is already committed.
    try {
      await this.mailService.sendMfaRecoveryNoticeEmail(
        user.email,
        user.name,
        ipAddress,
        userAgent,
      );
    } catch (error) {
      this.logger.error(
        `Falló el aviso de recuperación de MFA a ${maskEmail(user.email)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      message:
        'MFA desactivado con el código de recuperación. Vuelve a habilitarlo cuanto antes.',
    };
  }

  /**
   * Genera MFA_RECOVERY_CODES_COUNT códigos en texto plano (para mostrar UNA
   * vez al usuario) y persiste solo su hash argon2 -- nunca el texto plano,
   * mismo criterio que passwordHash. Reemplaza cualquier tanda previa: una
   * cuenta solo puede tener una tanda de recovery codes vigente a la vez,
   * así que volver a habilitar MFA invalida los códigos de una habilitación
   * anterior.
   */
  private async generateAndPersistRecoveryCodes(
    userId: string,
  ): Promise<string[]> {
    const codes = Array.from({ length: MFA_RECOVERY_CODES_COUNT }, () =>
      this.generateRecoveryCode(),
    );
    const hashedCodes = await Promise.all(
      codes.map((code) => argon2.hash(code)),
    );

    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: hashedCodes.map((codeHash) => ({ userId, codeHash })),
      }),
    ]);

    return codes;
  }

  private generateRecoveryCode(): string {
    // 10 bytes -> 20 chars hex, formateados en grupos de 4 para legibilidad
    // (ej. a1b2-c3d4-e5f6-a7b8-c9d0).
    const raw = crypto.randomBytes(10).toString('hex');
    return raw.match(/.{1,4}/g)!.join('-');
  }

  // Issue #192: every session token carries a `jti` backed by a Session row so
  // it can be revoked (logout / logout-all) before the JWT expires.
  private async generateToken(
    user: {
      id: string;
      email: string;
      role: string;
      name: string;
    },
    ipAddress?: string,
    userAgent?: string,
  ) {
    const jti = randomUUID();
    const payload = {
      jti,
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    };

    const accessToken = this.jwtService.sign(payload);
    const decoded = this.jwtService.decode<{ exp?: number }>(accessToken);
    // JwtModule always sets exp (JWT_EXPIRES_IN); the fallback is defensive.
    const expiresAt = new Date(
      decoded?.exp ? decoded.exp * 1000 : Date.now() + 8 * 60 * 60 * 1000,
    );

    await this.prisma.session.create({
      data: {
        jti,
        userId: user.id,
        expiresAt,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });

    // Único punto donde se emite una sesión (verify, recovery y enrolamiento
    // forzado pasan por acá): un LOGIN por sesión, sin doble registro.
    await logAuditFailOpen(this.auditService, this.logger, {
      userId: user.id,
      action: 'LOGIN',
      resource: 'Auth',
      resourceId: user.id,
      ipAddress,
      userAgent,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
    };
  }
}
