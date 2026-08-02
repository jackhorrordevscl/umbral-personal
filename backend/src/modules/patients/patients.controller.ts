import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { RecordConsentDto } from './dto/record-consent.dto';
import { AccessOverrideDto } from './dto/access-override.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('patients')
export class PatientsController {
  constructor(private patientsService: PatientsService) {}

  // ── Rutas protegidas ────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreatePatientDto, @CurrentUser() user: any) {
    return this.patientsService.create(dto, user.id, user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@CurrentUser() user: any) {
    return this.patientsService.findAll(user.id, user.role);
  }

  // T6.5 (issue #52): única vía para que SUPERVISOR ubique una ficha que su
  // propio findAll ya no le devuelve (sin consentimiento HEALTH_NETWORK), y
  // así pueda usar accessOverride sobre su id. No es un atajo de acceso: se
  // resuelve a un id y se delega la decisión completa en findOne, misma
  // regla que cualquier otra ruta. Restringido a SUPERVISOR -- THERAPIST/
  // COORDINATOR ya buscan sobre la lista que su propio findAll les entrega
  // y no necesitan una vía que revele si un RUT pertenece a algún paciente
  // de la clínica fuera de lo que ya pueden ver. Nótese que este path tiene
  // 2 segmentos ('by-rut/:rut'), así que Nest no lo confunde con ':id' (1
  // segmento) sin importar el orden de declaración.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @Get('by-rut/:rut')
  findByRut(@Param('rut') rut: string, @CurrentUser() user: any) {
    return this.patientsService.findByRut(rut, user.id, user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/history')
  getHistory(@Param('id') id: string, @CurrentUser() user: any) {
    return this.patientsService.getHistory(id, user.id, user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.patientsService.findOne(id, user.id, user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentUser() user: any,
  ) {
    return this.patientsService.update(id, dto, user.id, user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  softDelete(@Param('id') id: string, @CurrentUser() user: any) {
    return this.patientsService.softDelete(id, user.id, user.role);
  }

  // T6.1 (issue #27): consentimiento granular por finalidad (Ley 21.719)
  @UseGuards(JwtAuthGuard)
  @Post(':id/consents')
  recordConsent(
    @Param('id') id: string,
    @Body() dto: RecordConsentDto,
    @CurrentUser() user: any,
  ) {
    return this.patientsService.recordConsent(id, dto, user.id, user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/consents/status')
  getConsentStatus(@Param('id') id: string, @CurrentUser() user: any) {
    return this.patientsService.getCurrentConsentStatus(
      id,
      user.id,
      user.role,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/consents')
  getConsentLedger(@Param('id') id: string, @CurrentUser() user: any) {
    return this.patientsService.getConsentLedger(id, user.id, user.role);
  }

  // T6.5 (issue #52): única vía para que SUPERVISOR acceda a una ficha sin
  // consentimiento HEALTH_NETWORK vigente. @Roles('SUPERVISOR') es lo que
  // realmente impide que otro rol la use. El motivo (AccessOverrideDto,
  // mínimo 10 caracteres, trimeado) queda auditado de forma síncrona y
  // bloqueante dentro del service -- no delegado por completo en el log
  // automático de AuditInterceptor, que es fail-open por diseño.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERVISOR')
  @Post(':id/access-override')
  accessOverride(
    @Param('id') id: string,
    @Body() dto: AccessOverrideDto,
    @CurrentUser() user: any,
  ) {
    return this.patientsService.accessOverride(
      id,
      user.id,
      user.role,
      dto.overrideReason,
    );
  }
}