import { Module } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { PatientsController } from './patients.controller';
import { CalendarIntegrationModule } from '../calendar-integration/calendar-integration.module';

// sdd/google-calendar-integration T5.7: importa CalendarIntegrationModule
// para que PatientsService pueda inyectar CalendarSyncService y disparar
// deletePatientEvents() fire-and-forget desde softDelete() -- sin ciclo:
// CalendarIntegrationModule no importa patients.
@Module({
  imports: [CalendarIntegrationModule],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
