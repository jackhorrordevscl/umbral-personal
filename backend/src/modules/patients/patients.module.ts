import { Module } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { PatientsController } from './patients.controller';
import { CalendarIntegrationModule } from '../calendar-integration/calendar-integration.module';
import { PaymentsModule } from '../payments/payments.module';

// sdd/google-calendar-integration T5.7: importa CalendarIntegrationModule
// para que PatientsService pueda inyectar CalendarSyncService y disparar
// deletePatientEvents() fire-and-forget desde softDelete() -- sin ciclo:
// CalendarIntegrationModule no importa patients.
//
// issue #110: mismo criterio para PaymentsModule -- PatientsService inyecta
// PaymentsService y llama cancelUnpaidForPatient() desde softDelete() para
// cancelar los cargos PENDING/LATE del paciente eliminado. Sin ciclo:
// PaymentsModule solo importa ConfigModule/MailModule/NotificationsModule,
// ninguno de los cuales importa patients (ConsultationsModule ya importa
// ambos módulos juntos con el mismo criterio, ver consultations.module.ts).
@Module({
  imports: [CalendarIntegrationModule, PaymentsModule],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
