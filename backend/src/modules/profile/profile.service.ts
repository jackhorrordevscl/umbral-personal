import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { EmailChangeService } from './email-change.service';
import { AuditService } from '../audit/audit.service';
import { assertFileContentMatchesMimetype } from '../../common/utils/file-signature.util';
import * as argon2 from 'argon2';
import * as path from 'path';
import * as fs from 'fs/promises';

// Ruta fija por usuario (SIN extensión) -- cada nuevo upload pisa el
// anterior, sin dejar huérfanos ni necesitar limpieza de archivos viejos.
// El tipo real detectado se guarda aparte en User.avatarMimeType para poder
// servir el Content-Type correcto al leerlo (ver getAvatar). No es PHI
// clínico (es la foto del propio profesional, no de un paciente), por eso
// no pasa por DocumentEncryptionService como los documentos de `documents/`.
const AVATAR_DIR = path.join(process.cwd(), 'uploads', 'avatars');

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
    private config: ConfigService,
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
        pendingEmail: true,
        avatarUpdatedAt: true,
      },
    });

    if (!user) throw new NotFoundException('Usuario no encontrado');

    // Issue #124: el frontend usa este flag para mostrar (o no) la UI de
    // generar invitaciones -- sin rol ADMIN (decisión explícita), la única
    // fuente de verdad de "quién puede invitar" es INVITE_CREATOR_EMAIL,
    // mismo email que AuthService.createInvitation exige al crear el código.
    const inviteCreatorEmail = this.config.get<string>('INVITE_CREATOR_EMAIL');
    const canInvite = Boolean(
      inviteCreatorEmail && user.email === inviteCreatorEmail,
    );

    return { ...user, canInvite };
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

    const data: {
      name?: string;
      passwordHash?: string;
      passwordChangedAt?: Date;
      pendingEmail?: null;
      pendingEmailTokenIssuedAt?: null;
    } = {};
    if (dto.name) data.name = dto.name;
    if (dto.password) {
      data.passwordHash = await argon2.hash(dto.password);
      // Issue #76 (PR B): JwtStrategy.validate() invalida cualquier token
      // emitido antes de este timestamp. También limpia un pendingEmail
      // existente (design.md, "Any password change also clears pending") --
      // si alguien más pidió un cambio de email con una sesión robada, el
      // dueño real recupera la cuenta cambiando la password sin depender de
      // que el token de email-change expire solo.
      data.passwordChangedAt = new Date();
      data.pendingEmail = null;
      data.pendingEmailTokenIssuedAt = null;
    }

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

  // El `fileFilter` del controller solo mira el header `mimetype` declarado
  // por el cliente (spoofable); esta es la validación real de contenido
  // (mismo criterio que DocumentsService.uploadDocument, issue #51), corre
  // sobre el buffer ya completo. Ruta fija (AVATAR_DIR/<id>, sin extensión):
  // este write pisa el archivo anterior si existía.
  async uploadAvatar(id: string, file: Express.Multer.File) {
    assertFileContentMatchesMimetype(file.buffer, file.mimetype);

    await fs.mkdir(AVATAR_DIR, { recursive: true });
    await fs.writeFile(path.join(AVATAR_DIR, id), file.buffer);

    const avatarUpdatedAt = new Date();
    await this.prisma.user.update({
      where: { id },
      data: { avatarMimeType: file.mimetype, avatarUpdatedAt },
    });

    return { avatarUpdatedAt };
  }

  // Solo el propio dueño ve su avatar (CurrentUser().id en el controller, no
  // recibe :id) -- no hace falta chequeo de acceso adicional, a diferencia de
  // DocumentsService (que sirve archivos de pacientes compartidos).
  async getAvatar(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { avatarMimeType: true },
    });

    if (!user?.avatarMimeType) {
      throw new NotFoundException('No hay foto de perfil');
    }

    const buffer = await fs.readFile(path.join(AVATAR_DIR, id));
    return { buffer, mimeType: user.avatarMimeType };
  }

  // Idempotente a propósito: "quitar foto" puede ejecutarse más de una vez
  // (doble click, retry de red) sin que el segundo intento deba fallar solo
  // porque el archivo ya no está. Solo se traga ENOENT (archivo inexistente);
  // cualquier otro error de fs (permisos, disco, etc.) se propaga tal cual.
  async deleteAvatar(id: string) {
    try {
      await fs.unlink(path.join(AVATAR_DIR, id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    await this.prisma.user.update({
      where: { id },
      data: { avatarMimeType: null, avatarUpdatedAt: null },
    });

    return { avatarUpdatedAt: null };
  }
}
