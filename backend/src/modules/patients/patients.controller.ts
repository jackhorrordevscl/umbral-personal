import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { RecordConsentDto } from './dto/record-consent.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@Controller('patients')
@UseGuards(JwtAuthGuard)
export class PatientsController {
  constructor(private patientsService: PatientsService) {}

  @Post()
  create(@Body() dto: CreatePatientDto, @CurrentUser() user: RequestUser) {
    return this.patientsService.create(dto, user.id);
  }

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.patientsService.findAll(user.id, query);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.patientsService.getHistory(id, user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.patientsService.findOne(id, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.patientsService.update(id, dto, user.id);
  }

  @Delete(':id')
  softDelete(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.patientsService.softDelete(id, user.id);
  }

  // T6.1 (issue #27): consentimiento granular por finalidad (Ley 21.719)
  @Post(':id/consents')
  recordConsent(
    @Param('id') id: string,
    @Body() dto: RecordConsentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.patientsService.recordConsent(id, dto, user.id);
  }

  @Get(':id/consents/status')
  getConsentStatus(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.patientsService.getCurrentConsentStatus(id, user.id);
  }

  @Get(':id/consents')
  getConsentLedger(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.patientsService.getConsentLedger(id, user.id);
  }
}
