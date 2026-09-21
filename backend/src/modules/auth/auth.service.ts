import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SignupDto } from './dto/signup.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { User } from '@prisma/client';
import { MFA_SETUP_PURPOSE } from './mfa.service';
import { getDummyPasswordHash } from './dummy-password-hash.util';

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

// Issue #124: signup público sin invitación, sin rol ADMIN (decisión
// explícita). INVITE_CREATOR_EMAIL es el único email autorizado a generar
// invitaciones -- mecanismo temporal mientras el producto sigue siendo de un
// solo profesional por cuenta; createInvitation() rechaza a cualquier otro
// email con ForbiddenException.
const INVITATION_EXPIRES_IN_MS = 7 * 24 * 60 * 60 * 1000;

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
  //
  // Issue #124: signup público sin invitación (sin rol ADMIN, decisión
  // explícita). Un InvitationCode válido (existe, sin usar, no expirado) es
  // ahora requisito para crear cuenta -- se valida y se marca usado en la
  // MISMA $transaction que crea el User, para que un fallo de cualquiera de
  // las dos operaciones no deje ni una invitación "gastada" sin cuenta ni
  // una cuenta creada con una invitación que sigue viéndose disponible.
  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('El email ya está registrado');
    }

    const invitation = await this.prisma.invitationCode.findUnique({
      where: { code: dto.inviteCode },
    });
    if (
      !invitation ||
      invitation.usedById ||
      invitation.expiresAt < new Date()
    ) {
      throw new UnauthorizedException(
        'Código de invitación inválido o expirado',
      );
    }

    const passwordHash = await argon2.hash(dto.password);
    // Transacción interactiva (no el array-form usado en otros métodos de
    // este archivo) porque el segundo paso -- enlazar usedById en el
    // InvitationCode -- necesita el id del User recién creado en el primero;
    // el array-form ejecuta ambas operaciones ya construidas de antemano y no
    // permite esa dependencia. Si cualquiera de las dos falla, Prisma
    // revierte ambas: no queda ni una invitación "gastada" sin cuenta ni una
    // cuenta creada con una invitación que sigue viéndose disponible.
    //
    // El marcado como usado va con updateMany + where usedById: null (no
    // update por id) para que sea atómico contra el findUnique de arriba: dos
    // signups concurrentes con el mismo código todavía válido podrían pasar
    // ambos ese chequeo antes de que cualquiera lo marque usado -- el segundo
    // updateMany de este par encuentra count 0 (el primero ya puso
    // usedById) y aborta toda la transacción, en vez de dejar dos cuentas
    // creadas con una sola invitación.
    const user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          name: dto.name,
          emailVerified: false,
        },
      });
      const { count } = await tx.invitationCode.updateMany({
        where: { id: invitation.id, usedById: null },
        data: { usedById: createdUser.id, usedAt: new Date() },
      });
      if (count === 0) {
        throw new UnauthorizedException(
          'Código de invitación inválido o expirado',
        );
      }
      return createdUser;
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
    // Issue #76 (PR B): passwordChangedAt invalida (vía JwtStrategy) todo
    // token emitido antes de este cambio -- mismo campo que PATCH /profile y
    // resetPassword, único punto de verdad para "cuándo cambió la
    // contraseña de esta cuenta" sin importar por qué flujo haya sido.
    // También limpia un pendingEmail existente (design.md, "Any password
    // change also clears pending"): si un atacante con el passwordChangeToken
    // robado (o con la sesión previa) dejó un cambio de email pendiente, el
    // cambio de contraseña forzado no debe dejarlo sobrevivir -- mismo
    // criterio que el branch de password de ProfileService.update.
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        pendingEmail: null,
        pendingEmailTokenIssuedAt: null,
      },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      resource: 'User',
      resourceId: user.id,
      detail: 'Contraseña actualizada (cambio forzado, mustChangePassword)',
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
    // Issue #76 (PR B): mismo passwordChangedAt que PATCH /profile y el
    // completion de mustChangePassword -- JwtStrategy.validate() lo usa para
    // rechazar cualquier token emitido antes de este reset, en TODOS los
    // dispositivos donde la cuenta tuviera sesión activa.
    // También limpia un pendingEmail existente (design.md, "Any password
    // change also clears pending"): si un atacante con un token robado dejó
    // un cambio de email pendiente abierto, el reset self-service de la
    // víctima (el flujo pensado justamente para expulsar al atacante) no
    // debe dejar sobrevivir ese cambio pendiente -- mismo criterio que el
    // branch de password de ProfileService.update.
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        passwordResetTokenIssuedAt: null,
        passwordChangedAt: new Date(),
        pendingEmail: null,
        pendingEmailTokenIssuedAt: null,
      },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'PASSWORD_RESET_COMPLETED',
      resource: 'User',
      resourceId: user.id,
    });
    await this.auditService.log({
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      resource: 'User',
      resourceId: user.id,
      detail: 'Contraseña actualizada vía reset self-service',
    });

    return { message: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
  }

  /**
   * Issue #124: signup público sin invitación, sin rol ADMIN (decisión
   * explícita). Solo el email configurado en INVITE_CREATOR_EMAIL puede
   * generar invitaciones -- mecanismo temporal mientras el producto siga
   * siendo de un solo profesional por cuenta. El código no es un JWT: es un
   * valor random persistido en DB (mismo motivo que MfaRecoveryCode) porque
   * signup() necesita poder marcarlo "usado" de forma atómica junto con la
   * creación del User.
   */
  async createInvitation(user: RequestUser) {
    const inviteCreatorEmail = this.config.get<string>('INVITE_CREATOR_EMAIL');
    if (!inviteCreatorEmail || user.email !== inviteCreatorEmail) {
      throw new ForbiddenException(
        'No tienes permiso para generar invitaciones',
      );
    }

    // 6 bytes -> 12 chars hex: suficientemente corto para copiar/pegar a
    // mano, y con suficiente entropía para un código de un solo uso con
    // expiración de 7 días (mismo criterio de tamaño que un recovery code
    // individual, ver generateRecoveryCode).
    const code = crypto.randomBytes(6).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRES_IN_MS);

    const invitation = await this.prisma.invitationCode.create({
      data: {
        code,
        createdById: user.id,
        expiresAt,
      },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'CREATE',
      resource: 'InvitationCode',
      resourceId: invitation.id,
    });

    return { code: invitation.code, expiresAt: invitation.expiresAt };
  }
}
