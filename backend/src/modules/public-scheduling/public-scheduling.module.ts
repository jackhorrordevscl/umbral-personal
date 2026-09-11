import { Module } from '@nestjs/common';
import { PublicSchedulingController } from './public-scheduling.controller';
import { PublicSchedulingService } from './public-scheduling.service';
import { PublicScheduleThrottlerGuard } from './public-schedule-throttler.guard';
import { AvailabilityModule } from '../availability/availability.module';
import { PatientsModule } from '../patients/patients.module';
import { ConsultationsModule } from '../consultations/consultations.module';

// sdd/patient-self-scheduling PR 3 (design.md "Technical Approach"):
// importa AvailabilityModule + PatientsModule + ConsultationsModule -- sin
// ciclo, ninguno de los tres importa public-scheduling (mismo criterio
// documentado en consultations.module.ts). No registra su propio
// ThrottlerModule: 'public-availability'/'public-booking' ya quedan
// registrados por AuthModule (ThrottlerModule es @Global() en v6, tal como
// documenta auth.module.ts).
@Module({
  imports: [AvailabilityModule, PatientsModule, ConsultationsModule],
  controllers: [PublicSchedulingController],
  providers: [PublicSchedulingService, PublicScheduleThrottlerGuard],
})
export class PublicSchedulingModule {}
