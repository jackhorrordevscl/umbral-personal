import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { CorrectConsultationDto } from './dto/correct-consultation.dto';
import { ConsultationRangeQueryDto } from './dto/consultation-range-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@UseGuards(JwtAuthGuard)
@Controller('consultations')
export class ConsultationsController {
  constructor(private consultationsService: ConsultationsService) {}

  @Post()
  create(@Body() dto: CreateConsultationDto, @CurrentUser() user: RequestUser) {
    return this.consultationsService.create(dto, user.id);
  }

  @Get('patient/:patientId')
  findByPatient(
    @Param('patientId') patientId: string,
    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.consultationsService.findByPatient(patientId, user.id, query);
  }

  // Issue #40: agregado en el backend en vez de que el dashboard resuelva
  // "cuántas consultas tiene cada paciente" haciendo un GET por paciente
  // (N+1). Debe declararse ANTES de :id -- si no, Express/Nest matchea
  // "stats" contra ese wildcard de un solo segmento.
  @Get('stats')
  getStats(@CurrentUser() user: RequestUser) {
    return this.consultationsService.getStats(user.id);
  }

  // sdd/session-calendar-view PR1: mismo hazard de wildcard que "stats" --
  // debe declararse ANTES de :id o Nest matchea "range" contra ese wildcard
  // de un solo segmento.
  @Get('range')
  findByRange(
    @Query() query: ConsultationRangeQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.consultationsService.findByRange(user.id, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.consultationsService.findOne(id, user.id);
  }

  @Patch(':id/correct')
  correct(
    @Param('id') id: string,
    @Body() dto: CorrectConsultationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.consultationsService.correct(id, dto, user.id);
  }
}
