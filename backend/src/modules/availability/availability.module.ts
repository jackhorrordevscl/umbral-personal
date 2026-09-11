import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AvailabilityController } from './availability.controller';

// sdd/patient-self-scheduling PR 2 (design.md "Two new backend modules"):
// AvailabilityController expone el CRUD autenticado (tasks.md 2.4/2.5) sobre
// AvailabilityService. Exporta AvailabilityService para que
// PublicSchedulingModule (PR 3) pueda importarlo sin ciclo (design.md "no
// cycle, since none of the three imports it").
@Module({
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
