import {
  Controller,
  Post,
  Get,
  Param,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  // T8.1 (issue #58): sin `storage` explícito, FileInterceptor usa memoria
  // (no diskStorage) -- el archivo llega en `file.buffer` sin tocar el disco,
  // así DocumentsService puede cifrarlo antes de escribirlo.
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (req, file, cb) => {
        // Solo acepta PDFs e imágenes
        if (
          file.mimetype === 'application/pdf' ||
          file.mimetype.startsWith('image/')
        ) {
          cb(null, true);
        } else {
          cb(new Error('Solo se permiten archivos PDF e imágenes'), false);
        }
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB máximo
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('patientId') patientId: string,
    @Body('type') type: string,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.uploadDocument(
      patientId,
      user.id,
      user.role,
      file,
      type,
    );
  }

  @Get('patient/:patientId')
  findByPatient(
    @Param('patientId') patientId: string,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.findByPatient(patientId, user.id, user.role);
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { doc, buffer } = await this.documentsService.getDecryptedFile(
      id,
      user.id,
      user.role,
    );
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.fileName)}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
