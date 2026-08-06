import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SignupDto } from './dto/signup.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MfaRecoverDto } from './dto/mfa-recover.dto';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { User } from '@prisma/client';

// Purpose que llevan los JWT de corta duración emitidos para forzar el
// enrolamiento MFA. Nunca deben aceptarse como sesión (ver jwt.strategy.ts).
const MFA_SETUP_PURPOSE = 'mfa-setup';

// Idem para el cambio de contraseña forzado (T4.4 / issue #22): el admin
// semilla (y cualquier cuenta creada con mustChangePassword=true) no puede
// operar con la contraseña semilla conocida hasta cambiarla.
const PASSWORD_CHANGE_PURPOSE = 'password-change';

// Idem para la verificación de email del signup propio (issue #5): el link
// que llega por correo lleva este token, nunca un userId crudo.
const EMAIL_VERIFY_PURPOSE = 'email-verify';
const EMAIL_VERIFY_EXPIRES_IN = '24h';

// Idem para el flujo self-service de forgot/reset password (issue #50):
// única puerta de recuperación de cuenta que no depende de una intervención
// manual en la base de datos.
const PASSWORD_RESET_PURPOSE = 'password-reset';
const PASSWORD_RESET_EXPIRES_IN = '30m';

// Mensaje de forgotPassword: siempre el mismo exista o no la cuenta, para no
// filtrar (vía diferencia de respuesta) qué emails están registrados.
const FORGOT_PASSWORD_GENERIC_MESSAGE = {
  message:
    'Si el email está registrado, vas a recibir un enlace para restablecer tu contraseña.',
};

// Mismo criterio que FORGOT_PASSWORD_GENERIC_MESSAGE: la respuesta no debe
// distinguir entre email inexistente, ya verificado, o recién reenviado --
// cualquier diferencia de respuesta filtraría qué cuentas existen y en qué
// estado están.
const RESEND_VERIFICATION_GENERIC_MESSAGE = {
  message:
    'Si el email está registrado y pendiente de verificar, vas a recibir un nuevo enlace.',
};

// Hash argon2 dummy contra el que verificar cuando el email no existe -- sin
// esto, un email inexistente responde de inmediato mientras uno real corre
// argon2.verify (costoso a propósito), generando un timing oracle que
// permite enumerar cuentas aunque el mensaje de error sea idéntico en ambos
// casos. Se genera una sola vez de forma perezosa (no hardcodeado: así el
// hash es válido para la versión de argon2 realmente instalada) y se
// reusa en cada intento de login/recover con email inexistente.
let dummyPasswordHash: Promise<string> | null = null;
function getDummyPasswordHash(): Promise<string> {
  if (!dummyPasswordHash) {
    dummyPasswordHash = argon2.hash('umbral-timing-safe-dummy-value');
  }
  return dummyPasswordHash;
}

// Issue #50: cantidad de códigos de recuperación de MFA generados por
// enableMfa. 10 es el estándar de facto (GitHub, Google) -- suficiente para
// varios extravíos del dispositivo TOTP sin ser tantos que degrade la
// seguridad de tenerlos impresos/guardados.
const MFA_RECOVERY_CODES_COUNT = 10;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private mailService: MailService,
    private auditService: AuditService,
  ) {}

  // Issue #5: único componente genuinamente nuevo del MVP -- en la versión
  // institucional las cuentas las creaba un ADMIN (POST /users, eliminado en
  // b0354c0), pero sin jerarquía no hay quién las cree. La cuenta queda
  // creada con emailVerified=false y sin poder loguear (ver login()) hasta
  // que el dueño del email confirme el link enviado acá.
  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('El email ya está registrado');
    }

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        emailVerified: false,
      },
    });

    const token = this.jwtService.sign(
      { sub: user.id, purpose: EMAIL_VERIFY_PURPOSE },
      { expiresIn: EMAIL_VERIFY_EXPIRES_IN },
    );
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const verifyUrl = `${frontendUrl}/verify-email?token=${token}`;

    await this.mailService.sendVerificationEmail(
      user.email,
      user.name,
      verifyUrl,
    );

    return {
      message:
        'Cuenta creada. Revisa tu email para verificarla antes de iniciar sesión.',
    };
  }

  async verifyEmail(token: string) {
    let payload: { sub: string; purpose?: string };
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException(
        'Token de verificación inválido o expirado',
      );
    }

    if (payload.purpose !== EMAIL_VERIFY_PURPOSE) {
      throw new UnauthorizedException('Token de verificación inválido');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Usuario no válido');
    }

    // Un token de verificación es un JWT sin estado, válido hasta que expira
    // (24h) — sin este chequeo, reutilizarlo no haría daño funcional (ya
    // dejaría emailVerified=true), pero mismo patrón de replay guard que el
    // resto de los tokens de propósito único de este archivo.
    if (user.emailVerified) {
      throw new UnauthorizedException('Este email ya fue verificado');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });

    return { message: 'Email verificado. Ya puedes iniciar sesión.' };
  }

  /**
   * Reenvío del link de verificación (compliance: login() ya bloquea a una
   * cuenta sin verificar sin darle ninguna salida self-service si el primer
   * email se perdió/expiró en 24h). Mismo patrón anti-enumeración que
   * forgotPassword: respuesta genérica siempre, exista o no el email, esté o
   * no ya verificado -- así no se filtra qué cuentas están registradas ni en
   * qué estado de verificación quedaron.
   */
  async resendVerificationEmail(dto: ResendVerificationDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || user.deletedAt || user.emailVerified) {
      return RESEND_VERIFICATION_GENERIC_MESSAGE;
    }

    const token = this.jwtService.sign(
      { sub: user.id, purpose: EMAIL_VERIFY_PURPOSE },
      { expiresIn: EMAIL_VERIFY_EXPIRES_IN },
    );
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const verifyUrl = `${frontendUrl}/verify-email?token=${token}`;

    await this.mailService.sendVerificationEmail(
      user.email,
      user.name,
      verifyUrl,
    );

    return RESEND_VERIFICATION_GENERIC_MESSAGE;
  }

  async login(dto: LoginDto) {
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

    // Se verifica ANTES que mustChangePassword/MFA: una cuenta de signup
    // propio sin verificar no debería poder avanzar a ningún paso posterior
    // del login, ni siquiera a enrolar MFA.
    if (!user.emailVerified) {
      throw new UnauthorizedException(
        'Debes verificar tu email antes de iniciar sesión',
      );
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

    // MFA es obligatorio para toda cuenta: el único rol de este producto
    // maneja el 100% de los datos clínicos propios, sin el alcance acotado
    // que tenía THERAPIST en la versión institucional (donde MFA forzado
    // solo aplicaba a roles administrativos). Sin accessToken hasta enrolar:
    // se entrega un JWT de corta duración con purpose 'mfa-setup', que solo
    // sirve para beginMfaSetup/confirmMfaSetup (jwt.strategy.ts lo rechaza
    // como Bearer token de sesión). Nunca se devuelve el userId crudo: sin
    // este token firmado cualquiera podría iniciar el enrolamiento MFA de
    // otra cuenta sin conocer su contraseña.
    const setupToken = this.jwtService.sign(
      { sub: user.id, purpose: MFA_SETUP_PURPOSE },
      { expiresIn: '10m' },
    );
    return {
      requiresMfaSetup: true,
      setupToken,
    };
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

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Usuario no válido');
    }

    // Un passwordChangeToken es un JWT sin estado, válido hasta que expira
    // (10 min). Sin este chequeo, un token filtrado (logs, proxies) seguiría
    // sirviendo para volver a cambiar la contraseña — y tomar la cuenta —
    // aunque el cambio legítimo ya hubiera terminado. Mismo patrón que
    // rejectIfAlreadyEnrolled para el replay del setupToken de MFA.
    if (!user.mustChangePassword) {
      throw new UnauthorizedException(
        'La contraseña ya fue actualizada anteriormente',
      );
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
      throw new UnauthorizedException(
        'Token de cambio de contraseña inválido o expirado',
      );
    }

    if (payload.purpose !== PASSWORD_CHANGE_PURPOSE) {
      throw new UnauthorizedException('Token de cambio de contraseña inválido');
    }

    return payload;
  }

  /**
   * Issue #50: paso 1 del flujo self-service de recuperación de cuenta.
   * Respuesta genérica SIEMPRE (exista o no el email, esté o no soft-
   * deleted) para no filtrar qué cuentas están registradas vía diferencia
   * de respuesta/tiempo. Solo si el usuario existe se persiste el timestamp
   * y se dispara el email; en cualquier otro caso es un no-op silencioso.
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || user.deletedAt) {
      return FORGOT_PASSWORD_GENERIC_MESSAGE;
    }

    // Se guarda el timestamp además de firmarlo en el JWT: un token de reset
    // es un JWT sin estado, válido hasta que expira (30 min). Sin este
    // replay guard, un link filtrado (logs, bandeja compartida) seguiría
    // sirviendo para resetear la contraseña después de que el usuario ya
    // hubiera cambiado la suya. También invalida cualquier link previo sin
    // usar: pedir un reset nuevo pisa el timestamp anterior.
    const issuedAt = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordResetTokenIssuedAt: issuedAt },
    });

    const resetToken = this.jwtService.sign(
      {
        sub: user.id,
        purpose: PASSWORD_RESET_PURPOSE,
        resetIssuedAt: issuedAt.getTime(),
      },
      { expiresIn: PASSWORD_RESET_EXPIRES_IN },
    );
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    await this.mailService.sendPasswordResetEmail(
      user.email,
      user.name,
      resetUrl,
    );
    await this.auditService.log({
      userId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      resource: 'User',
      resourceId: user.id,
    });

    return FORGOT_PASSWORD_GENERIC_MESSAGE;
  }

  /**
   * Issue #50: paso 2. No delega en completeLogin ni emite accessToken a
   * propósito -- a diferencia de changePassword (cambio forzado dentro de un
   * login ya en curso), este es un reset self-service iniciado sin sesión;
   * el usuario vuelve a pasar por login normal (y por MFA si lo tiene
   * habilitado) con la contraseña nueva, sin bypasear ningún factor.
   */
  async resetPassword(dto: ResetPasswordDto) {
    let payload: { sub: string; purpose?: string; resetIssuedAt?: number };
    try {
      payload = this.jwtService.verify(dto.resetToken);
    } catch {
      throw new UnauthorizedException(
        'Token de restablecimiento inválido o expirado',
      );
    }

    if (payload.purpose !== PASSWORD_RESET_PURPOSE) {
      throw new UnauthorizedException('Token de restablecimiento inválido');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Usuario no válido');
    }

    if (
      !user.passwordResetTokenIssuedAt ||
      user.passwordResetTokenIssuedAt.getTime() !== payload.resetIssuedAt
    ) {
      throw new UnauthorizedException(
        'Token de restablecimiento inválido o ya utilizado',
      );
    }

    const newPasswordHash = await argon2.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        passwordResetTokenIssuedAt: null,
      },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'PASSWORD_RESET_COMPLETED',
      resource: 'User',
      resourceId: user.id,
    });

    return { message: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
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
    if (!user || !user.mfaSecret || user.deletedAt) {
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
