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
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';
import { UploadDocumentDto } from './dto/upload-document.dto';

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
        // PDF, imágenes, Word/Excel (viejo y OOXML) y ZIP -- los cuatro
        // últimos ya estaban soportados por assertFileContentMatchesMimetype
        // (file-signature.util.ts), solo faltaba destrabarlos acá.
        const ALLOWED_MIMETYPES = [
          'application/pdf',
          'application/msword',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/zip',
        ];
        if (
          ALLOWED_MIMETYPES.includes(file.mimetype) ||
          file.mimetype.startsWith('image/')
        ) {
          cb(null, true);
        } else {
          cb(
            new Error(
              'Solo se permiten archivos PDF, Word, Excel, ZIP e imágenes',
            ),
            false,
          );
        }
      },
      // 25MB: el archivo se bufferiza completo en memoria antes de cifrarlo
      // (fileFilter arriba, sin diskStorage), así que este techo evita
      // arriesgar OOM en la instancia con un par de uploads concurrentes de
      // expedientes judiciales grandes.
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.documentsService.uploadDocument(
      dto.patientId,
      user.id,
      file,
      dto.type,
    );
  }

  @Get('patient/:patientId')
  findByPatient(
    @Param('patientId') patientId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.documentsService.findByPatient(patientId, user.id);
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    const { doc, buffer } = await this.documentsService.getDecryptedFile(
      id,
      user.id,
    );
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.fileName)}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
