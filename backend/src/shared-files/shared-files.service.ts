// src/shared-files/shared-files.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FileCategory } from '@prisma/client';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { UploadSharedFileDto } from './dto/upload-shared-file.dto';
import { UpdateSharedFileDto } from './dto/update-shared-file.dto';
import { assertFileContentMatchesMimetype } from '../common/utils/file-signature.util';

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
    // valida el contenido real ya escrito a disco (issue #51). Si no
    // coincide, se borra el archivo huérfano antes de propagar el error.
    try {
      const buffer = await fsp.readFile(file.path);
      assertFileContentMatchesMimetype(buffer, file.mimetype);
    } catch (err) {
      await fsp.unlink(file.path).catch(() => undefined);
      throw err;
    }

    return this.prisma.sharedFile.create({
      data: {
        name: dto.name || file.originalname,
        originalName: file.originalname,
        filename: file.filename,
        path: file.path,
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

  async getFilePath(id: string, userId: string): Promise<string> {
    const file = await this.findOne(id, userId);
    if (!fs.existsSync(file.path)) {
      throw new NotFoundException(
        'Archivo físico no encontrado en el servidor',
      );
    }
    return file.path;
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
