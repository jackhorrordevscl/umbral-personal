import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import * as argon2 from 'argon2';

@Injectable()
export class ProfileService {
  constructor(private prisma: PrismaService) {}

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

  async update(id: string, dto: UpdateProfileDto) {
    if (dto.email) {
      const exists = await this.prisma.user.findFirst({
        where: { email: dto.email, id: { not: id } },
        select: { id: true },
      });
      if (exists) throw new ConflictException('El email ya está registrado');
    }

    const data: { email?: string; name?: string; passwordHash?: string } = {};
    if (dto.email) data.email = dto.email;
    if (dto.name) data.name = dto.name;
    if (dto.password) data.passwordHash = await argon2.hash(dto.password);

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        mfaEnabled: true,
        updatedAt: true,
      },
    });
  }
}
