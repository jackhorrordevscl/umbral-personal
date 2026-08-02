import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { Role, User } from '@prisma/client';

// Roles administrativos: no pueden operar sin MFA (T4.1 / issue #19).
const MFA_REQUIRED_ROLES: Role[] = [Role.ADMIN, Role.SUPERVISOR];

// Purpose que llevan los JWT de corta duración emitidos para forzar el
// enrolamiento MFA. Nunca deben aceptarse como sesión (ver jwt.strategy.ts).
const MFA_SETUP_PURPOSE = 'mfa-setup';

// Idem para el cambio de contraseña forzado (T4.4 / issue #22): el admin
// semilla (y cualquier cuenta creada con mustChangePassword=true) no puede
// operar con la contraseña semilla conocida hasta cambiarla.
const PASSWORD_CHANGE_PURPOSE = 'password-change';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (user.mustChangePassword) {
      // Se verifica ANTES que MFA a propósito: no tiene sentido enrolar MFA
      // sobre una contraseña semilla conocida por cualquiera que haya leído
      // seed.ts o el repo (público). Ningún token de sesión ni de enrolamiento
      // MFA se emite hasta que la contraseña cambie.
      const passwordChangeToken = this.jwtService.sign(
        { sub: user.id, purpose: PASSWORD_CHANGE_PURPOSE },
        { expiresIn: '10m' },
      );
      return {
        requiresPasswordChange: true,
        passwordChangeToken,
      };
    }

    return this.completeLogin(user);
  }

  /**
   * Continuación común de login() y changePassword(): decide si el usuario
   * necesita MFA (ya enrolado, o enrolamiento forzado) o si recibe un
   * accessToken directo. Separado en su propio método porque changePassword
   * necesita exactamente esta misma decisión después de actualizar la
   * contraseña, sin repetir la lógica de MFA.
   */
  private completeLogin(user: User) {
    if (user.mfaEnabled) {
      return {
        requiresMfa: true,
        userId: user.id,
      };
    }

    if (MFA_REQUIRED_ROLES.includes(user.role)) {
      // Rol administrativo sin MFA: no se emite accessToken. Se entrega un
      // JWT de corta duración con purpose 'mfa-setup', que solo sirve para
      // beginMfaSetup/confirmMfaSetup (jwt.strategy.ts lo rechaza como
      // Bearer token de sesión). Nunca se devuelve el userId crudo: filtra
      // por otras rutas (editedById/changedById en el historial) y sin este
      // token firmado cualquiera podría iniciar el enrolamiento MFA de otra
      // cuenta sin conocer su contraseña.
      const setupToken = this.jwtService.sign(
        { sub: user.id, purpose: MFA_SETUP_PURPOSE },
        { expiresIn: '10m' },
      );
      return {
        requiresMfaSetup: true,
        setupToken,
      };
    }

    return this.generateToken(user);
  }

  /**
   * Cambio de contraseña forzado (T4.4, issue #22) para cuentas con
   * mustChangePassword=true (el admin semilla, u otra cuenta marcada así).
   * Recibe el passwordChangeToken de corta duración emitido por login(),
   * nunca un userId crudo ni la contraseña anterior — el token YA probó que
   * quien llama conoce la contraseña semilla (login la verificó para
   * emitirlo). Termina en el mismo flujo que un login exitoso
   * (completeLogin), sin volver a pedir credenciales.
   */
  async changePassword(dto: ChangePasswordDto) {
    const payload = this.verifyPasswordChangeToken(dto.passwordChangeToken);

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Usuario no válido');
    }

    // Un passwordChangeToken es un JWT sin estado, válido hasta que expira
    // (10 min). Sin este chequeo, un token filtrado (logs, proxies) seguiría
    // sirviendo para volver a cambiar la contraseña — y tomar la cuenta —
    // aunque el cambio legítimo ya hubiera terminado. Mismo patrón que
    // rejectIfAlreadyEnrolled para el replay del setupToken de MFA.
    if (!user.mustChangePassword) {
      throw new UnauthorizedException('La contraseña ya fue actualizada anteriormente');
    }

    const newPasswordHash = await argon2.hash(dto.newPassword);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash, mustChangePassword: false },
    });

    return this.completeLogin(updated);
  }

  /**
   * Verifica un passwordChangeToken: firma válida, no expirado, y
   * purpose === 'password-change'. jwt.strategy.ts además impide que este
   * mismo token se use como Bearer token de sesión en cualquier otra ruta.
   */
  private verifyPasswordChangeToken(passwordChangeToken: string): {
    sub: string;
    purpose?: string;
  } {
    let payload: { sub: string; purpose?: string };
    try {
      payload = this.jwtService.verify(passwordChangeToken);
    } catch {
      throw new UnauthorizedException('Token de cambio de contraseña inválido o expirado');
    }

    if (payload.purpose !== PASSWORD_CHANGE_PURPOSE) {
      throw new UnauthorizedException('Token de cambio de contraseña inválido');
    }

    return payload;
  }

  /**
   * Enrolamiento MFA forzado (paso 1) para roles administrativos sin MFA.
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
  async confirmMfaSetup(setupToken: string, token: string) {
    const payload = this.verifySetupToken(setupToken);
    await this.rejectIfAlreadyEnrolled(payload.sub);
    await this.enableMfa(payload.sub, token);

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('Usuario no válido');

    return this.generateToken(user);
  }

  /**
   * Verifica un setupToken de enrolamiento MFA forzado: firma válida, no
   * expirado, y purpose === 'mfa-setup'. Es la única puerta de entrada para
   * beginMfaSetup/confirmMfaSetup; jwt.strategy.ts además impide que este
   * mismo token se use como Bearer token de sesión en cualquier otra ruta.
   */
  private verifySetupToken(setupToken: string): { sub: string; purpose?: string } {
    let payload: { sub: string; purpose?: string };
    try {
      payload = this.jwtService.verify(setupToken);
    } catch {
      throw new UnauthorizedException('Token de configuración MFA inválido o expirado');
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
      throw new UnauthorizedException('MFA ya fue configurado para esta cuenta');
    }
  }

  async verifyMfa(dto: VerifyMfaDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user || !user.mfaSecret) {
      throw new UnauthorizedException('Usuario no válido');
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

    return this.generateToken(user);
  }

  async generateMfaSecret(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Usuario no válido');

    const secret = speakeasy.generateSecret({
      name: `Umbral SpA (${user.email})`,
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

  async enableMfa(userId: string, token: string) {
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

    return { message: 'MFA activado correctamente' };
  }

  async disableMfa(userId: string, token: string) {
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

    return { message: 'MFA desactivado correctamente' };
  }

  private generateToken(user: { id: string; email: string; role: string, name: string }) {
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