import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { readAvatarBuffer } from '../../common/utils/avatar-storage.util';

// Issue #155: perfil público del terapeuta mostrado en la autoagenda
// (PublicBookingPage), antes del calendario. Servicio separado de
// PublicSchedulingService a propósito -- ese servicio orquesta
// disponibilidad/booking (availability, patients, consultations, payments,
// notifications); esto es una lectura de solo dos columnas del propio User,
// sin ninguna de esas dependencias.
@Injectable()
export class PublicTherapistProfileService {
  constructor(private readonly prisma: PrismaService) {}

  // role: PROFESSIONAL excluye explícitamente cualquier id que no sea un
  // terapeuta real (hoy es el único valor del enum, pero el chequeo queda
  // documentado por si se agrega un rol acotado más adelante, ver
  // schema.prisma). Nunca se devuelve email ni ningún otro dato sensible --
  // este endpoint no tiene guard de auth.
  async getProfile(therapistId: string) {
    const therapist = await this.prisma.user.findFirst({
      where: { id: therapistId, deletedAt: null, role: Role.PROFESSIONAL },
      select: { name: true, bio: true, specialty: true, avatarMimeType: true },
    });
    if (!therapist) {
      throw new NotFoundException('Terapeuta no encontrado.');
    }

    return {
      name: therapist.name,
      bio: therapist.bio,
      specialty: therapist.specialty,
      hasAvatar: therapist.avatarMimeType != null,
    };
  }

  async getAvatar(therapistId: string) {
    const therapist = await this.prisma.user.findFirst({
      where: { id: therapistId, deletedAt: null, role: Role.PROFESSIONAL },
      select: { avatarMimeType: true },
    });
    if (!therapist?.avatarMimeType) {
      throw new NotFoundException('El terapeuta no tiene foto de perfil.');
    }

    try {
      const buffer = await readAvatarBuffer(therapistId);
      return { buffer, mimeType: therapist.avatarMimeType };
    } catch (err) {
      // El disco de Render (plan free) es efímero: un redeploy borra
      // uploads/avatars/ pero no toca avatarMimeType en la DB, dejando un
      // registro "tiene avatar" que apunta a un archivo que ya no existe.
      // Se trata como "sin avatar" (404) en vez de explotar con 500.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('El terapeuta no tiene foto de perfil.');
      }
      throw err;
    }
  }
}
