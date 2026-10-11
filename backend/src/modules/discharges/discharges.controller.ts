import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { DischargesService } from './discharges.service';
import { CreateDischargeDto } from './dto/create-discharge.dto';
import { UpdateDischargeDto } from './dto/update-discharge.dto';
import { UploadDischargeDto } from './dto/upload-discharge.dto';
import { MAX_DOCUMENT_UPLOAD_BYTES } from '../documents/documents.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';
import { SkipAudit } from '../../common/decorators/skip-audit.decorator';
import { AuditRead } from '../../common/decorators/audit-read.decorator';
import { getRequestClientIp } from '../../common/utils/client-ip.util';

// Subida del PDF propio (T3b): en memoria (sin diskStorage), solo application/pdf
// y con el mismo tope que los documentos. El servicio revalida el contenido real
// (firma %PDF-), porque el mimetype lo declara el cliente.
const pdfUploadInterceptor = FileInterceptor('file', {
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(
        new BadRequestException('Solo se permite subir un archivo PDF.'),
        false,
      );
    }
  },
  limits: { fileSize: MAX_DOCUMENT_UPLOAD_BYTES, files: 1 },
});

function auditContext(req: Request) {
  return {
    ipAddress: getRequestClientIp(req),
    userAgent: req.headers['user-agent'],
  };
}

// Sin prefijo de controlador: las rutas cuelgan de /patients/:patientId/... y de
// /discharges/..., igual que el contrato del plan.
@UseGuards(JwtAuthGuard)
@Controller()
export class DischargesController {
  constructor(private dischargesService: DischargesService) {}

  @Post('patients/:patientId/discharges')
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateDischargeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.dischargesService.createDraft(patientId, dto, user.id);
  }

  @Get('patients/:patientId/discharges')
  findByPatient(
    @Param('patientId') patientId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.dischargesService.findByPatient(patientId, user.id);
  }

  @Get('discharges/:id')
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.dischargesService.findOne(id, user.id);
  }

  @Patch('discharges/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDischargeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.dischargesService.update(id, dto, user.id);
  }

  // T3b: sube el PDF propio y cierra el tratamiento en un solo paso (el informe
  // nace emitido). SkipAudit: el servicio registra DISCHARGE_ISSUE,
  // TREATMENT_CLOSED y CONSULTATION_CANCELLED.
  @SkipAudit()
  @Post('patients/:patientId/discharges/upload')
  @UseInterceptors(pdfUploadInterceptor)
  upload(
    @Param('patientId') patientId: string,
    @Body() dto: UploadDischargeDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.dischargesService.uploadReport(
      patientId,
      dto,
      file,
      user.id,
      auditContext(req),
    );
  }

  // @SkipAudit: el servicio registra DISCHARGE_ISSUE y TREATMENT_CLOSED de forma
  // explícita; sin esto el interceptor global agregaría una tercera fila genérica.
  @SkipAudit()
  @Post('discharges/:id/issue')
  issue(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.dischargesService.issue(id, user.id, auditContext(req));
  }

  @SkipAudit()
  @Post('discharges/:id/correct')
  correct(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.dischargesService.correct(id, user.id, auditContext(req));
  }

  // T3b: reemplazo versionado de un informe subido (nueva versión emitida).
  @SkipAudit()
  @Post('discharges/:id/correct-upload')
  @UseInterceptors(pdfUploadInterceptor)
  correctUpload(
    @Param('id') id: string,
    @Body() dto: UploadDischargeDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.dischargesService.correctUpload(
      id,
      dto,
      file,
      user.id,
      auditContext(req),
    );
  }

  // PDF del informe. AuditRead marca la lectura como descarga y registra el
  // paciente (resourceId sigue siendo el informe), igual que la descarga de
  // documentos. Si el PDF aún no existe, el servicio lo genera.
  @AuditRead({ detail: 'download' })
  @Get('discharges/:id/pdf')
  async pdf(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request & { auditPatientId?: string },
    @Res() res: Response,
  ) {
    const { buffer, fileName, patientId } = await this.dischargesService.getPdf(
      id,
      user.id,
    );
    req.auditPatientId = patientId;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('discharges/:id/verify')
  verify(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.dischargesService.verify(id, user.id);
  }
}
