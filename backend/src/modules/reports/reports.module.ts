import { Module } from '@nestjs/common';
import { ClinicalTextCryptoModule } from '../../common/crypto/clinical-text-crypto.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { PatientsModule } from '../patients/patients.module';

@Module({
  imports: [ClinicalTextCryptoModule, PatientsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
