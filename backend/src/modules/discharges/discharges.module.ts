import { Module } from '@nestjs/common';
import { DischargesController } from './discharges.controller';
import { DischargesService } from './discharges.service';
import { PatientsModule } from '../patients/patients.module';

// Informe de alta / cierre de tratamiento (T2). PrismaService y AuditService
// son globales; PatientsModule aporta assertAccess y assertTreatmentConsent.
// Sin ciclo: PatientsModule no importa este módulo. T2b sumará aquí
// AvailabilityModule, PaymentsModule y CalendarIntegrationModule para los
// efectos posteriores al commit.
@Module({
  imports: [PatientsModule],
  controllers: [DischargesController],
  providers: [DischargesService],
  exports: [DischargesService],
})
export class DischargesModule {}
