import { Module } from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { ConsultationsController } from './consultations.controller';
import { PatientsModule } from '../patients/patients.module';
import { CalendarIntegrationModule } from '../calendar-integration/calendar-integration.module';

// design.md "File Changes": importa CalendarIntegrationModule para que
// ConsultationsService pueda inyectar CalendarSyncService y disparar
// syncGroup() fire-and-forget tras create()/correct() (T5.5/T5.6) -- sin
// ciclo: CalendarIntegrationModule no importa ni consultations ni patients.
@Module({
  imports: [PatientsModule, CalendarIntegrationModule],
  controllers: [ConsultationsController],
  providers: [ConsultationsService],
})
export class ConsultationsModule {}
