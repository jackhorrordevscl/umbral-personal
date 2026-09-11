import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PublicSchedulingService } from './public-scheduling.service';
import { PublicAvailabilityQueryDto } from './dto/public-availability-query.dto';
import { BookPublicSlotDto } from './dto/book-public-slot.dto';
import { PublicScheduleThrottlerGuard } from './public-schedule-throttler.guard';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.6, spec.md "Public
// Availability Read Endpoint" / "Public Booking Write Endpoint"): SIN
// JwtAuthGuard a propósito -- ambas rutas son intencionalmente públicas
// (agenda de auto-reserva de un paciente sin cuenta). Controller delgado,
// mismo criterio que AvailabilityController/PatientsController: toda la
// lógica vive en PublicSchedulingService.
//
// Cada ruta saltea todos los throttlers nombrados que NO le corresponden --
// mismo criterio que AuthController con 'login'/'mfa-verify'/etc: sin esto,
// GET availability consumiría también cupo de 'public-booking' (y
// viceversa). ThrottlerModule es @Global() en esta versión de
// @nestjs/throttler (key learning de PR 3), así que esto incluye no solo
// los throttlers de AuthModule sino TAMBIÉN los de cualquier otro módulo que
// registre los suyos -- ProfileModule, por ejemplo, define 'profile-update'
// y 'email-change-confirm' en su propio buildProfileThrottlerOptions (no en
// auth.module.ts). Bug reportado en pruebas manuales: al faltar esos dos acá,
// GET /availability consumía en silencio cupo de 'email-change-confirm'
// (10 req/60s) hasta devolver 429 -- ver
// public-scheduling.controller.spec.ts para el test de exhaustividad
// inversa que ahora lo cubre.
const FOREIGN_THROTTLER_NAMES = {
  login: true,
  'mfa-verify': true,
  signup: true,
  'mfa-setup': true,
  'password-change': true,
  'verify-email': true,
  'password-reset': true,
  'mfa-recover': true,
  'resend-verification': true,
  'profile-update': true,
  'email-change-confirm': true,
} as const;

@Controller('public/therapists/:therapistId/availability')
export class PublicSchedulingController {
  constructor(
    private readonly publicSchedulingService: PublicSchedulingService,
  ) {}

  @UseGuards(PublicScheduleThrottlerGuard)
  @SkipThrottle({ ...FOREIGN_THROTTLER_NAMES, 'public-booking': true })
  @Get()
  getAvailability(
    @Param('therapistId') therapistId: string,
    @Query() query: PublicAvailabilityQueryDto,
  ) {
    return this.publicSchedulingService.getAvailability(therapistId, query);
  }

  @UseGuards(PublicScheduleThrottlerGuard)
  @SkipThrottle({ ...FOREIGN_THROTTLER_NAMES, 'public-availability': true })
  @Post('book')
  book(
    @Param('therapistId') therapistId: string,
    @Body() dto: BookPublicSlotDto,
  ) {
    return this.publicSchedulingService.book(therapistId, dto);
  }
}
