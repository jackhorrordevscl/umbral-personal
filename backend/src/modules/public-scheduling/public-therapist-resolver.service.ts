import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isUuid } from '../../common/utils/slug.util';

// El :therapistId de las rutas públicas acepta el slug del terapeuta (link
// actual, /book/juan-jose-martinez) o su UUID (links anteriores, que deben
// seguir funcionando). Este resolver es el único punto que traduce la
// referencia a id, para que todos los endpoints públicos se comporten igual.
//
// Un UUID se devuelve sin consultar la base: cada endpoint ya valida la
// existencia del terapeuta como antes, así el comportamiento con UUID
// (incluido el de un id desconocido) queda idéntico al previo al slug.
@Injectable()
export class PublicTherapistResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveId(ref: string): Promise<string | null> {
    if (isUuid(ref)) return ref;

    const therapist = await this.prisma.user.findFirst({
      where: { slug: ref, deletedAt: null, role: Role.PROFESSIONAL },
      select: { id: true },
    });
    return therapist?.id ?? null;
  }
}
