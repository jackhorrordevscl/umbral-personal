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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@UseGuards(JwtAuthGuard)
@Controller('consultations')
export class ConsultationsController {
  constructor(private consultationsService: ConsultationsService) {}

  @Post()
  create(@Body() dto: CreateConsultationDto, @CurrentUser() user: any) {
    return this.consultationsService.create(dto, user.id);
  }

  @Get('patient/:patientId')
  findByPatient(
    @Param('patientId') patientId: string,
    @CurrentUser() user: any,
    @Query() query: PaginationQueryDto,
  ) {
    return this.consultationsService.findByPatient(patientId, user.id, query);
  }

  // Issue #40: agregado en el backend en vez de que el dashboard resuelva
  // "cuántas consultas tiene cada paciente" haciendo un GET por paciente
  // (N+1). Debe declararse ANTES de :id -- si no, Express/Nest matchea
  // "stats" contra ese wildcard de un solo segmento.
  @Get('stats')
  getStats(@CurrentUser() user: any) {
    return this.consultationsService.getStats(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.consultationsService.findOne(id, user.id);
  }

  @Patch(':id/correct')
  correct(
    @Param('id') id: string,
    @Body() dto: CorrectConsultationDto,
    @CurrentUser() user: any,
  ) {
    return this.consultationsService.correct(id, dto, user.id);
  }
}
