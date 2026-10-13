import { Module } from '@nestjs/common';
import { DischargesController } from './discharges.controller';
import { DischargesService } from './discharges.service';
import { DischargeDeliveriesService } from './discharge-deliveries.service';
import { PatientsModule } from '../patients/patients.module';
import { AvailabilityModule } from '../availability/availability.module';
import { PaymentsModule } from '../payments/payments.module';
import { CalendarIntegrationModule } from '../calendar-integration/calendar-integration.module';
import { DocumentsModule } from '../documents/documents.module';
import { MailModule } from '../mail/mail.module';
import { DischargeCancellationNotifier } from './discharge-cancellation-notifier.service';

// Informe de alta / cierre de tratamiento (T2). PrismaService y AuditService
// son globales; PatientsModule aporta assertAccess y assertTreatmentConsent.
// T2b: AvailabilityModule, PaymentsModule y CalendarIntegrationModule aportan
// los efectos posteriores al commit (caché de slots, cobros y eventos de
// Google). Sin ciclo: ninguno de ellos importa este módulo, y los tres ya
// exportan el servicio que se inyecta.
// T3: DocumentsModule exporta DocumentsService, que guarda y lee (cifrado) el
// PDF del informe; no importa este módulo, así que no hay ciclo.
@Module({
  imports: [
    PatientsModule,
    AvailabilityModule,
    PaymentsModule,
    CalendarIntegrationModule,
    DocumentsModule,
    MailModule,
  ],
  controllers: [DischargesController],
  providers: [
    DischargesService,
    DischargeDeliveriesService,
    DischargeCancellationNotifier,
  ],
  exports: [DischargesService],
})
export class DischargesModule {}
