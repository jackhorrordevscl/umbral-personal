import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { normalizeEmail } from '../../common/utils/normalize-email.util';
import { logAuditFailOpen } from '../../common/utils/audit-fail-open.util';

// Issue #76: purpose de JWT propio para el cambio de email diferido, no
// reutiliza 'email-verify' (AuthService) -- ese payload solo lleva `sub`, sin
// atar el token a QUÉ dirección se está confirmando. Un token de
// email-change filtrado (logs, bandeja compartida) que solo llevara `sub`
// serviría para confirmar cualquier `pendingEmail` que el usuario tuviera
// seteado en el momento de usarlo, no necesariamente la dirección para la
// que se pidió -- ligar `pendingEmail` en el payload y compararlo contra el
// valor persistido en confirm() cierra esa ventana.
const EMAIL_CHANGE_PURPOSE = 'email-change';
const EMAIL_CHANGE_EXPIRES_IN = '24h';

interface RequestingUser {
  id: string;
  email: string;
  name: string;
}

interface EmailChangeTokenPayload {
  sub: string;
  purpose?: string;
  pendingEmail?: string;
  changeIssuedAt?: number;
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  );
}

@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private mailService: MailService,
    private auditService: AuditService,
  ) {}

  /**
   * Abre (o reemplaza, si ya había uno) un cambio de email pendiente. El
   * email activo (`user.email`) nunca se toca acá -- ver confirm(). Se
   * persiste el timestamp ANTES de firmar el token, mismo patrón replay
   * guard que AuthService.forgotPassword: una segunda solicitud pisa
   * pendingEmail/pendingEmailTokenIssuedAt, así que el token de la primera
   * deja de coincidir y confirm() lo rechaza (issue #76, "segunda solicitud
   * supersede a la primera").
   */
  async requestChange(
    user: RequestingUser,
    rawNewEmail: string,
  ): Promise<void> {
    // Issue #303: pendingEmail se guarda siempre en forma canónica.
    const newEmail = normalizeEmail(rawNewEmail);
    const issuedAt = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        pendingEmail: newEmail,
        pendingEmailTokenIssuedAt: issuedAt,
      },
    });

    const token = this.jwtService.sign(
      {
        sub: user.id,
        purpose: EMAIL_CHANGE_PURPOSE,
        pendingEmail: newEmail,
        changeIssuedAt: issuedAt.getTime(),
      },
      { expiresIn: EMAIL_CHANGE_EXPIRES_IN },
    );
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const confirmUrl = `${frontendUrl}/confirm-email-change?token=${token}`;

    // Judgment-day #499: los dos correos salen en secuencia y no son
    // atómicos. Si cualquiera falla se cancela el pedido pendiente: dejarlo
    // abierto sería un cambio de email cuyo dueño no fue avisado (falla el
    // aviso) o un enlace enviado de un pedido que respondió 500. Al limpiar
    // el estado pendiente, el enlace ya enviado deja de servir (replay guard).
    try {
      await this.mailService.sendEmailChangeVerificationEmail(
        newEmail,
        user.name,
        confirmUrl,
      );
      // Notificación a la dirección ACTUAL (no a la pendiente): si alguien más
      // solicitó el cambio con una sesión robada, el dueño real se entera por
      // la casilla que todavía controla, no por la que el atacante pidió.
      await this.mailService.sendEmailChangeNoticeEmail(
        user.email,
        user.name,
        newEmail,
      );
    } catch (err) {
      await this.cancelPendingChange(user.id, issuedAt);
      throw err;
    }

    // Fail-open: la solicitud ya quedó guardada y los correos ya salieron;
    // un fallo de auditoría no puede responder 500 sobre un pedido que existe.
    await logAuditFailOpen(this.auditService, this.logger, {
      userId: user.id,
      action: 'EMAIL_CHANGE_REQUESTED',
      resource: 'User',
      resourceId: user.id,
      detail: `oldEmail=${user.email} newEmail=${newEmail}`,
    });
  }

  /**
   * Compensación de requestChange: limpia el pedido pendiente solo si sigue
   * siendo el propio (mismo timestamp). Si entre tanto llegó otra solicitud
   * (que ya superó a esta), no se la pisa. Nunca lanza: el llamador relanza
   * el error original del correo.
   */
  private async cancelPendingChange(
    userId: string,
    issuedAt: Date,
  ): Promise<void> {
    try {
      await this.prisma.user.updateMany({
        where: { id: userId, pendingEmailTokenIssuedAt: issuedAt },
        data: { pendingEmail: null, pendingEmailTokenIssuedAt: null },
      });
    } catch (cleanupErr) {
      this.logger.error(
        `No se pudo cancelar el cambio de email pendiente tras fallar el envío: userId=${userId} — ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
      );
    }
  }

  /**
   * Segundo paso: activa `pendingEmail` como `email` real. Un token de
   * email-change es un JWT sin estado (válido hasta expirar, 24h) -- el
   * replay guard exige que `pendingEmailTokenIssuedAt` y `pendingEmail`
   * SIGAN coincidiendo con lo que el token firmó, así que ni un reuso tras
   * confirmar ni un token superseded por una solicitud posterior sirven.
   */
  async confirm(token: string): Promise<{ message: string }> {
    // Issue #293: todos los fallos de este método son 400 y no 401; un 401
    // cerraría la sesión en el frontend sin mostrar el error de confirmación.
    let payload: EmailChangeTokenPayload;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new BadRequestException(
        'Token de confirmación inválido o expirado',
      );
    }

    if (payload.purpose !== EMAIL_CHANGE_PURPOSE) {
      throw new BadRequestException('Token de confirmación inválido');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.deletedAt) {
      throw new BadRequestException('Usuario no válido');
    }

    if (
      !user.pendingEmailTokenIssuedAt ||
      user.pendingEmailTokenIssuedAt.getTime() !== payload.changeIssuedAt ||
      user.pendingEmail !== payload.pendingEmail
    ) {
      throw new BadRequestException(
        'Token de confirmación inválido o ya utilizado',
      );
    }

    let applied: { count: number };
    try {
      // Compare-and-set sobre el estado pendiente que validó el token: si
      // entre el SELECT y este UPDATE el dueño cambió la contraseña (que limpia
      // pendingEmail) o se pidió otro cambio, no se aplica el email viejo.
      applied = await this.prisma.user.updateMany({
        where: {
          id: user.id,
          pendingEmail: user.pendingEmail,
          pendingEmailTokenIssuedAt: user.pendingEmailTokenIssuedAt,
        },
        data: {
          email: user.pendingEmail,
          emailVerified: true,
          pendingEmail: null,
          pendingEmailTokenIssuedAt: null,
        },
      });
    } catch (err) {
      // pendingEmail no tiene constraint único propio (issue #76, pregunta
      // abierta del design): la colisión real se resuelve acá, contra el
      // unique de `email`, en el raro caso de que otra cuenta haya tomado
      // esa dirección entre la solicitud y esta confirmación.
      if (isUniqueConstraintError(err)) {
        throw new ConflictException('El email ya está registrado');
      }
      throw err;
    }

    if (applied.count === 0) {
      throw new BadRequestException(
        'Token de confirmación inválido o ya utilizado',
      );
    }

    // Fail-open: el email ya cambió y el token ya no sirve (el estado pendiente
    // se limpió). Si la auditoría lanzara, el usuario vería un 500 y su
    // reintento, "ya utilizado", con el cambio ya aplicado.
    await logAuditFailOpen(this.auditService, this.logger, {
      userId: user.id,
      action: 'EMAIL_CHANGE_CONFIRMED',
      resource: 'User',
      resourceId: user.id,
      detail: `oldEmail=${user.email} newEmail=${user.pendingEmail}`,
    });

    return { message: 'Email actualizado correctamente.' };
  }
}
