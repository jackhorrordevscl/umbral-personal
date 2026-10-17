import { Module } from '@nestjs/common';
import { ClinicalTextCryptoService } from './clinical-text-crypto.service';

// ADR 0004 (opción B): cifrado de los textos clínicos libres. Los módulos que
// leen o escriben esas columnas (consultas e informe de alta) importan este
// módulo; Nest crea una sola instancia, así que la clave se valida una vez al
// arrancar.
@Module({
  providers: [ClinicalTextCryptoService],
  exports: [ClinicalTextCryptoService],
})
export class ClinicalTextCryptoModule {}
