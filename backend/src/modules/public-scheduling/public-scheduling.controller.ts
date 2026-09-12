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
import { PaymentsService } from '../payments/payments.service';

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
    private readonly paymentsService: PaymentsService,
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

  // sdd/public-booking-payment-calendar PR 5 (tasks.md 5.2, design.md
  // "Interfaces / Contracts", Decision 5 "Checkout is polled, not awaited"):
  // sin guard de auth a propósito, mismo criterio que las otras dos rutas de
  // este controller -- la confirmación pública hace polling acá para saber
  // si ya apareció un paymentUrl. Reusa el bucket 'public-availability' en
  // vez de registrar un tercer throttler nombrado: es una lectura sin
  // efectos, del mismo perfil que GET .../availability, y un tercer nombre
  // global (ThrottlerModule es @Global(), ver el comentario de
  // FOREIGN_THROTTLER_NAMES) obligaría a agregar '@SkipThrottle' en TODAS
  // las rutas de AuthModule/ProfileModule que ya listan
  // 'public-availability'/'public-booking' explícitamente -- un blast radius
  // ajeno a este cambio. Por eso esta ruta salta los mismos throttlers
  // ajenos que getAvailability y su hermana 'public-booking', pero NO
  // 'public-availability' (comparte ese cupo).
  @UseGuards(PublicScheduleThrottlerGuard)
  @SkipThrottle({ ...FOREIGN_THROTTLER_NAMES, 'public-booking': true })
  @Get('book/:groupId/checkout')
  getCheckout(@Param('groupId') groupId: string) {
    return this.paymentsService.findCheckoutForBooking(groupId);
  }
}
