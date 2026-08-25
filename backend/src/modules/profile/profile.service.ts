import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { EmailChangeService } from './email-change.service';
import { AuditService } from '../audit/audit.service';
import * as argon2 from 'argon2';

const PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  mfaEnabled: true,
  updatedAt: true,
  pendingEmail: true,
} as const;

@Injectable()
export class ProfileService {
  constructor(
    private prisma: PrismaService,
    private emailChangeService: EmailChangeService,
    private auditService: AuditService,
  ) {}

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        mfaEnabled: true,
        createdAt: true,
      },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  // Compliance: historial de activación/desactivación de MFA visible para el
  // propio dueño de la cuenta -- ownership por userId, mismo criterio que el
  // resto de la app (un solo rol, cada quien ve únicamente sus propios
  // datos). TOTP no permite distinguir "dispositivos" reales (cualquier app
  // que escanee el mismo secreto es indistinguible para el backend); esto es
  // el registro de CUÁNDO y desde qué IP/user-agent se tocó MFA, no un
  // listado de dispositivos registrados.
  async getMfaHistory(userId: string) {
    return this.prisma.auditLog.findMany({
      where: {
        userId,
        action: {
          in: [
            'MFA_ENABLED',
            'MFA_DISABLED',
            'MFA_DISABLED_VIA_RECOVERY',
            'MFA_RECOVERY_CODES_GENERATED',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        action: true,
        createdAt: true,
        ipAddress: true,
        userAgent: true,
      },
    });
  }

  /**
   * Issue #76: step-up auth para cualquier cambio de email/password --
   * currentPassword se valida contra el hash real ANTES de tocar cualquier
   * otro campo, así que una currentPassword incorrecta rechaza el request
   * completo (ni siquiera `name` se aplica). Un update de solo `name` sigue
   * sin necesitar currentPassword: no es un cambio de credencial.
   *
   * El delta de email nunca pisa `email` directo -- se delega en
   * EmailChangeService.requestChange, que abre (o reemplaza) un cambio
   * pendiente confirmado desde la nueva casilla.
   */
  async update(id: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const requiresStepUp = Boolean(dto.email || dto.password);
    if (requiresStepUp) {
      if (!dto.currentPassword) {
        throw new UnauthorizedException(
          'Se requiere la contraseña actual para este cambio',
        );
      }
      const currentPasswordValid = await argon2.verify(
        user.passwordHash,
        dto.currentPassword,
      );
      if (!currentPasswordValid) {
        throw new UnauthorizedException('Contraseña actual incorrecta');
      }
    }

    const emailDelta = Boolean(dto.email && dto.email !== user.email);
    if (emailDelta) {
      const exists = await this.prisma.user.findFirst({
        where: { email: dto.email, id: { not: id } },
        select: { id: true },
      });
      if (exists) throw new ConflictException('El email ya está registrado');
    }

    const data: { name?: string; passwordHash?: string } = {};
    if (dto.name) data.name = dto.name;
    if (dto.password) data.passwordHash = await argon2.hash(dto.password);

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: PROFILE_SELECT,
    });

    if (emailDelta) {
      await this.emailChangeService.requestChange(
        { id: user.id, email: user.email, name: user.name },
        dto.email as string,
      );
      // `updated` se leyó antes de que requestChange escribiera pendingEmail
      // en la DB (segunda query, separada a propósito -- ver comentario de
      // clase); el caller necesita ver el pendingEmail recién seteado en la
      // respuesta sin pagar un tercer round-trip.
      updated.pendingEmail = dto.email as string;
    }

    if (dto.password) {
      await this.auditService.log({
        userId: id,
        action: 'PASSWORD_CHANGED',
        resource: 'User',
        resourceId: id,
        detail: 'Contraseña actualizada por el propio usuario (step-up auth)',
      });
    }

    return updated;
  }
}
