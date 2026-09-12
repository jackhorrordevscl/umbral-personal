import { Module } from '@nestjs/common';
import { PublicSchedulingController } from './public-scheduling.controller';
import { PublicSchedulingService } from './public-scheduling.service';
import { PublicScheduleThrottlerGuard } from './public-schedule-throttler.guard';
import { AvailabilityModule } from '../availability/availability.module';
import { PatientsModule } from '../patients/patients.module';
import { ConsultationsModule } from '../consultations/consultations.module';
import { PaymentsModule } from '../payments/payments.module';

// sdd/patient-self-scheduling PR 3 (design.md "Technical Approach"):
// importa AvailabilityModule + PatientsModule + ConsultationsModule -- sin
// ciclo, ninguno de los tres importa public-scheduling (mismo criterio
// documentado en consultations.module.ts). No registra su propio
// ThrottlerModule: 'public-availability'/'public-booking' ya quedan
// registrados por AuthModule (ThrottlerModule es @Global() en v6, tal como
// documenta auth.module.ts).
//
// sdd/public-booking-payment-calendar PR 5 (tasks.md 5.2): importa
// PaymentsModule para que el controller pueda inyectar PaymentsService y
// exponer GET .../checkout (findCheckoutForBooking, PR 4.1). PaymentsModule
// no importa ni consultations ni public-scheduling (ver
// payments.module.ts), así que tampoco hay ciclo acá.
@Module({
  imports: [
    AvailabilityModule,
    PatientsModule,
    ConsultationsModule,
    PaymentsModule,
  ],
  controllers: [PublicSchedulingController],
  providers: [PublicSchedulingService, PublicScheduleThrottlerGuard],
})
export class PublicSchedulingModule {}
