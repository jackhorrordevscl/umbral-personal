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
// Cada ruta saltea el throttler nombrado que NO le corresponde -- mismo
// criterio que AuthController con 'login'/'mfa-verify'/etc: sin esto, GET
// availability consumiría también cupo de 'public-booking' (y viceversa).
@Controller('public/therapists/:therapistId/availability')
export class PublicSchedulingController {
  constructor(
    private readonly publicSchedulingService: PublicSchedulingService,
  ) {}

  @UseGuards(PublicScheduleThrottlerGuard)
  @SkipThrottle({
    login: true,
    'mfa-verify': true,
    signup: true,
    'mfa-setup': true,
    'password-change': true,
    'verify-email': true,
    'password-reset': true,
    'mfa-recover': true,
    'resend-verification': true,
    'public-booking': true,
  })
  @Get()
  getAvailability(
    @Param('therapistId') therapistId: string,
    @Query() query: PublicAvailabilityQueryDto,
  ) {
    return this.publicSchedulingService.getAvailability(therapistId, query);
  }

  @UseGuards(PublicScheduleThrottlerGuard)
  @SkipThrottle({
    login: true,
    'mfa-verify': true,
    signup: true,
    'mfa-setup': true,
    'password-change': true,
    'verify-email': true,
    'password-reset': true,
    'mfa-recover': true,
    'resend-verification': true,
    'public-availability': true,
  })
  @Post('book')
  book(
    @Param('therapistId') therapistId: string,
    @Body() dto: BookPublicSlotDto,
  ) {
    return this.publicSchedulingService.book(therapistId, dto);
  }
}
