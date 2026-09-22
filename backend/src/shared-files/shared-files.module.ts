import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { SharedFilesController } from './shared-files.controller';
import { SharedFilesService } from './shared-files.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BadRequestException } from '@nestjs/common';

const ALLOWED_MIMETYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'Word (.doc)',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'Word (.docx)',
  'application/vnd.ms-excel': 'Excel (.xls)',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    'Excel (.xlsx)',
  'application/vnd.ms-powerpoint': 'PowerPoint (.ppt)',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'PowerPoint (.pptx)',
  'image/jpeg': 'Imagen JPEG',
  'image/png': 'Imagen PNG',
  'image/gif': 'Imagen GIF',
  'image/webp': 'Imagen WebP',
  'text/plain': 'Texto plano (.txt)',
  'application/zip': 'ZIP',
};

@Module({
  imports: [
    PrismaModule,
    MulterModule.register({
      // Issue #170: Render (plan free) no tiene disco persistente -- el
      // buffer queda solo en RAM (nunca toca disco) hasta que el service lo
      // sube a B2 (ver shared-files.service.ts / shared-file-storage.util.ts).
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIMETYPES[file.mimetype]) {
          cb(null, true);
        } else {
          const allowed = Object.values(ALLOWED_MIMETYPES).join(', ');
          cb(
            new BadRequestException(
              `Tipo de archivo no admitido: "${extname(file.originalname) || file.mimetype}". ` +
                `Formatos permitidos: ${allowed}.`,
            ),
            false,
          );
        }
      },
    }),
  ],
  controllers: [SharedFilesController],
  providers: [SharedFilesService],
  exports: [SharedFilesService],
})
export class SharedFilesModule {}
