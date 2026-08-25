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
  async requestChange(user: RequestingUser, newEmail: string): Promise<void> {
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

    await this.auditService.log({
      userId: user.id,
      action: 'EMAIL_CHANGE_REQUESTED',
      resource: 'User',
      resourceId: user.id,
      detail: `oldEmail=${user.email} newEmail=${newEmail}`,
    });
  }

  /**
   * Segundo paso: activa `pendingEmail` como `email` real. Un token de
   * email-change es un JWT sin estado (válido hasta expirar, 24h) -- el
   * replay guard exige que `pendingEmailTokenIssuedAt` y `pendingEmail`
   * SIGAN coincidiendo con lo que el token firmó, así que ni un reuso tras
   * confirmar ni un token superseded por una solicitud posterior sirven.
   */
  async confirm(token: string): Promise<{ message: string }> {
    let payload: EmailChangeTokenPayload;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException(
        'Token de confirmación inválido o expirado',
      );
    }

    if (payload.purpose !== EMAIL_CHANGE_PURPOSE) {
      throw new UnauthorizedException('Token de confirmación inválido');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Usuario no válido');
    }

    if (
      !user.pendingEmailTokenIssuedAt ||
      user.pendingEmailTokenIssuedAt.getTime() !== payload.changeIssuedAt ||
      user.pendingEmail !== payload.pendingEmail
    ) {
      throw new UnauthorizedException(
        'Token de confirmación inválido o ya utilizado',
      );
    }

    try {
      await this.prisma.user.update({
        where: { id: user.id },
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

    await this.auditService.log({
      userId: user.id,
      action: 'EMAIL_CHANGE_CONFIRMED',
      resource: 'User',
      resourceId: user.id,
      detail: `oldEmail=${user.email} newEmail=${user.pendingEmail}`,
    });

    return { message: 'Email actualizado correctamente.' };
  }
}
