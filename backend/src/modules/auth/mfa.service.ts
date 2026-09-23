import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { MfaRecoverDto } from './dto/mfa-recover.dto';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { getDummyPasswordHash } from './dummy-password-hash.util';

// Purpose que llevan los JWT de corta duración emitidos para forzar el
// enrolamiento MFA. Nunca deben aceptarse como sesión (ver jwt.strategy.ts).
// Se exporta porque AuthService.completeLogin() sigue necesitando esta
// constante para FIRMAR el setupToken que después consume MfaService.
export const MFA_SETUP_PURPOSE = 'mfa-setup';

// Issue #50: cantidad de códigos de recuperación de MFA generados por
// enableMfa. 10 es el estándar de facto (GitHub, Google) -- suficiente para
// varios extravíos del dispositivo TOTP sin ser tantos que degrade la
// seguridad de tenerlos impresos/guardados.
const MFA_RECOVERY_CODES_COUNT = 10;

@Injectable()
export class MfaService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private auditService: AuditService,
  ) {}

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

    return { ...this.generateToken(user), recoveryCodes };
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

  async verifyMfa(dto: VerifyMfaDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    // mfa/verify es un endpoint standalone que recibe un userId crudo (no
    // requiere haber pasado por login() primero), así que necesita su propio
    // chequeo de deletedAt -- sin esto, una cuenta desactivada tras un
    // incidente (ej. offboarding de un colaborador comprometido) podía
    // seguir logueando con el TOTP que ya tenía de antes de la revocación.
    // El mensaje es el mismo que el de un TOTP incorrecto: como el endpoint
    // recibe un userId crudo, distinguirlos permitiría enumerar qué userId
    // existen y tienen MFA activo.
    if (!user || !user.mfaSecret || user.deletedAt) {
      throw new UnauthorizedException('Código MFA inválido');
    }

    const isValid = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token: dto.token,
      window: 1,
    });

    if (!isValid) {
      throw new UnauthorizedException('Código MFA inválido');
    }

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

    return this.generateToken(user);
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
      data: { mfaSecret: secret.base32 },
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

    const isValid = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token,
      window: 1,
    });

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

    const isValid = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token,
      window: 1,
    });

    if (!isValid) {
      throw new UnauthorizedException('Código inválido');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null },
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
  async recoverMfa(dto: MfaRecoverDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || user.deletedAt) {
      await argon2.verify(await getDummyPasswordHash(), dto.password);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
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
      throw new UnauthorizedException('Código de recuperación inválido');
    }

    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.update({
        where: { id: matchedCodeId },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { mfaEnabled: false, mfaSecret: null },
      }),
    ]);

    await this.auditService.log({
      userId: user.id,
      action: 'MFA_DISABLED_VIA_RECOVERY',
      resource: 'User',
      resourceId: user.id,
    });

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

  private generateToken(user: {
    id: string;
    email: string;
    role: string;
    name: string;
  }) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
    };
  }
}
