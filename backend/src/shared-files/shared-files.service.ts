// src/shared-files/shared-files.service.ts
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FileCategory } from '@prisma/client';
import * as fs from 'fs';

export interface UploadFileDto {
  name: string;
  description?: string;
  category?: FileCategory;
}

@Injectable()
export class SharedFilesService {
  constructor(private prisma: PrismaService) {}

  async uploadFile(
    file: Express.Multer.File,
    dto: UploadFileDto,
    userId: string,
  ) {
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
    if (!file) throw new NotFoundException('Archivo no encontrado');
    if (file.uploadedById !== userId) {
      throw new ForbiddenException('No tienes permiso para acceder a este archivo');
    }
    return file;
  }

  async getFilePath(id: string, userId: string): Promise<string> {
    const file = await this.findOne(id, userId);
    if (!fs.existsSync(file.path)) {
      throw new NotFoundException('Archivo físico no encontrado en el servidor');
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

  async updateFile(id: string, dto: Partial<UploadFileDto>, userId: string) {
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
