import { Module } from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { ConsultationsController } from './consultations.controller';
import { PatientsModule } from '../patients/patients.module';
import { CalendarIntegrationModule } from '../calendar-integration/calendar-integration.module';
import { PaymentsModule } from '../payments/payments.module';

// design.md "File Changes": importa CalendarIntegrationModule para que
// ConsultationsService pueda inyectar CalendarSyncService y disparar
// syncGroup() fire-and-forget tras create()/correct() (T5.5/T5.6) -- sin
// ciclo: CalendarIntegrationModule no importa ni consultations ni patients.
// sdd/online-payment-integration PR 1 (T2.6): mismo criterio para
// PaymentsModule -- ConsultationsService inyecta PaymentsService y dispara
// ensureCharge() fire-and-forget tras create()/correct() (T2.5); sin ciclo,
// PaymentsModule no importa consultations ni patients.
@Module({
  imports: [PatientsModule, CalendarIntegrationModule, PaymentsModule],
  controllers: [ConsultationsController],
  providers: [ConsultationsService],
})
export class ConsultationsModule {}
