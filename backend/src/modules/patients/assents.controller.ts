import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AssentsService } from './assents.service';
import { RecordAssentDto } from './dto/record-assent.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';

// Append-only: there is deliberately no PATCH or DELETE. Audit: the global
// AuditInterceptor records the POST with resource "Patient" and resourceId =
// :patientId (it reads params.patientId), same as guardians.controller.ts.
@Controller('patients/:patientId/assents')
@UseGuards(JwtAuthGuard)
export class AssentsController {
  constructor(private assentsService: AssentsService) {}

  @Get()
  list(
    @Param('patientId') patientId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.assentsService.list(patientId, user.id);
  }

  @Post()
  record(
    @Param('patientId') patientId: string,
    @Body() dto: RecordAssentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.assentsService.record(patientId, dto, user.id);
  }
}
