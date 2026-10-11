import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { DocumentEncryptionService } from './document-encryption.service';
import { PatientsModule } from '../patients/patients.module';

@Module({
  imports: [PatientsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentEncryptionService],
  // T3: el módulo discharges guarda y lee el PDF del informe de alta.
  exports: [DocumentsService, DocumentEncryptionService],
})
export class DocumentsModule {}
