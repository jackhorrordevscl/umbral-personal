import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { CorrectConsultationDto } from './dto/correct-consultation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('consultations')
export class ConsultationsController {
  constructor(private consultationsService: ConsultationsService) {}

  @Post()
  create(@Body() dto: CreateConsultationDto, @CurrentUser() user: any) {
    return this.consultationsService.create(dto, user.id, user.role);
  }

  @Get('patient/:patientId')
  findByPatient(
    @Param('patientId') patientId: string,
    @CurrentUser() user: any,
  ) {
    return this.consultationsService.findByPatient(patientId, user.id, user.role);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.consultationsService.findOne(id, user.id, user.role);
  }

  @Patch(':id/correct')
  correct(
    @Param('id') id: string,
    @Body() dto: CorrectConsultationDto,
    @CurrentUser() user: any,
  ) {
    return this.consultationsService.correct(id, dto, user.id, user.role);
  }
}