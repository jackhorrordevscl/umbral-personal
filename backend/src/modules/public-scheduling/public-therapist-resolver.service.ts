import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isUuid } from '../../common/utils/slug.util';

// El :therapistId de las rutas públicas acepta el slug del terapeuta (link
// actual, /book/juan-jose-martinez) o su UUID (links anteriores, que deben
// seguir funcionando). Este resolver es el único punto que traduce la
// referencia a id, para que todos los endpoints públicos se comporten igual.
//
// Issue #496: el UUID recibe los mismos filtros que el slug (terapeuta activo
// y con rol PROFESSIONAL); antes se devolvía sin consultar la base y un UUID
// de un usuario borrado o de otro rol seguía operando. Un UUID desconocido se
// comporta como un slug desconocido.
@Injectable()
export class PublicTherapistResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveId(ref: string): Promise<string | null> {
    const therapist = await this.prisma.user.findFirst({
      where: {
        ...(isUuid(ref) ? { id: ref } : { slug: ref }),
        deletedAt: null,
        role: Role.PROFESSIONAL,
      },
      select: { id: true },
    });
    return therapist?.id ?? null;
  }
}
