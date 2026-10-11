import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GuardiansService } from './guardians.service';
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { UpdateGuardianDto } from './dto/update-guardian.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';

// Audit: the global AuditInterceptor already records POST/PATCH/DELETE here
// with resource "Patient" and resourceId = :patientId (it reads
// params.patientId), and the URL in `detail` carries the guardian id.
@Controller('patients/:patientId/guardians')
@UseGuards(JwtAuthGuard)
export class GuardiansController {
  constructor(private guardiansService: GuardiansService) {}

  @Get()
  list(
    @Param('patientId') patientId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.guardiansService.list(patientId, user.id);
  }

  @Post()
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateGuardianDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.guardiansService.create(patientId, dto, user.id);
  }

  @Patch(':guardianId')
  update(
    @Param('patientId') patientId: string,
    @Param('guardianId') guardianId: string,
    @Body() dto: UpdateGuardianDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.guardiansService.update(patientId, guardianId, dto, user.id);
  }

  @Delete(':guardianId')
  remove(
    @Param('patientId') patientId: string,
    @Param('guardianId') guardianId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.guardiansService.remove(patientId, guardianId, user.id);
  }
}
