import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { DischargesService } from './discharges.service';
import { CreateDischargeDto } from './dto/create-discharge.dto';
import { UpdateDischargeDto } from './dto/update-discharge.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';
import { SkipAudit } from '../../common/decorators/skip-audit.decorator';
import { getRequestClientIp } from '../../common/utils/client-ip.util';

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

  @Get('discharges/:id/verify')
  verify(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.dischargesService.verify(id, user.id);
  }
}
