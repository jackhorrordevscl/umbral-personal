// src/shared-files/shared-files.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FileCategory } from '@prisma/client';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { UploadSharedFileDto } from './dto/upload-shared-file.dto';
import { UpdateSharedFileDto } from './dto/update-shared-file.dto';
import { assertFileContentMatchesMimetype } from '../common/utils/file-signature.util';
import {
  readSharedFileBuffer,
  writeSharedFileBuffer,
  isSharedFileNotFoundError,
} from '../common/utils/shared-file-storage.util';

// "Shared" es el nombre heredado de la versión institucional multi-
// profesional: hoy cada método filtra por uploadedById === userId, es una
// biblioteca 100% privada por usuario, no se comparte nada entre
// profesionales (ver comentario en el modelo SharedFile de schema.prisma).
//
// Decisión (issue #38): a diferencia de `documents` (que cifra en reposo con
// AES-256-GCM porque guarda documentos legales/clínicos del PACIENTE bajo
// Ley 20.584), `shared-files` guarda material de trabajo del propio
// profesional (plantillas, formularios, protocolos, libros) sin datos de
// pacientes -- no hay obligación legal equivalente y el contenido no es
// sensible del mismo modo. Se mantiene sin cifrar deliberadamente; si algún
// día se permite subir acá archivos con datos de pacientes, esta decisión
// hay que revisitarla.
@Injectable()
export class SharedFilesService {
  constructor(private prisma: PrismaService) {}

  async uploadFile(
    file: Express.Multer.File,
    dto: UploadSharedFileDto,
    userId: string,
  ) {
    // El `fileFilter` del multer module (shared-files.module.ts) solo mira
    // el header `mimetype` declarado por el cliente (spoofable); acá se
    // valida el contenido real ya en memoria (issue #51). Con
    // `memoryStorage` no hay archivo huérfano en disco que limpiar si la
    // validación falla -- simplemente no se sube a B2.
    assertFileContentMatchesMimetype(file.buffer, file.mimetype);

    // Issue #170: un objeto por archivo (no "un objeto fijo por usuario"
    // como en avatares), mismo criterio de nombrado que antes generaba
    // `diskStorage` en el multer module.
    const objectKey = `${randomUUID()}${extname(file.originalname)}`;
    await writeSharedFileBuffer(objectKey, file.buffer);

    return this.prisma.sharedFile.create({
      data: {
        name: dto.name || file.originalname,
        originalName: file.originalname,
        // `filename` se reutiliza como objectKey en B2 -- sin cambio de
        // schema. `path` ya no representa una ruta real en disco, se
        // mantiene con el mismo valor por ser un campo NOT NULL heredado.
        filename: objectKey,
        path: objectKey,
        mimetype: file.mimetype,
        size: file.size,
        category: dto.category ?? 'GENERAL',
        description: dto.description,
        uploadedById: userId,
      },
      include: { uploadedBy: { select: { name: true, email: true } } },
    });
  }

  async findAll(userId: string, category?: FileCategory) {
    return this.prisma.sharedFile.findMany({
      where: {
        isActive: true,
        uploadedById: userId,
        ...(category ? { category } : {}),
      },
      include: {
        uploadedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const file = await this.prisma.sharedFile.findFirst({
      where: { id, isActive: true },
      include: { uploadedBy: { select: { name: true } } },
    });
    // NotFoundException uniforme tanto si el archivo no existe como si
    // pertenece a otro usuario: no distinguir evita filtrar (vía 403 vs 404)
    // que un id ajeno corresponde a un archivo real -- mismo criterio que
    // assertAccess en patients.service.ts.
    if (!file || file.uploadedById !== userId) {
      throw new NotFoundException('Archivo no encontrado');
    }
    return file;
  }

  async getFileBuffer(id: string, userId: string): Promise<Buffer> {
    const file = await this.findOne(id, userId);
    try {
      return await readSharedFileBuffer(file.filename);
    } catch (err) {
      // El registro en DB puede sobrevivir aunque el objeto en B2 ya no
      // exista (borrado manual, migración incompleta, o -- para archivos
      // subidos antes de esta migración -- pérdida por el disco efímero de
      // Render). Se trata como 404 en vez de explotar con 500 (mismo fix
      // que PR #169 aplicó a avatares).
      if (isSharedFileNotFoundError(err)) {
        throw new NotFoundException(
          'Archivo físico no encontrado en el servidor',
        );
      }
      throw err;
    }
  }

  async deleteFile(id: string, userId: string) {
    await this.findOne(id, userId);
    // Soft delete
    await this.prisma.sharedFile.update({
      where: { id },
      data: { isActive: false },
    });
    return { message: 'Archivo eliminado correctamente' };
  }

  async updateFile(id: string, dto: UpdateSharedFileDto, userId: string) {
    await this.findOne(id, userId);

    return this.prisma.sharedFile.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category && { category: dto.category }),
      },
    });
  }
}
