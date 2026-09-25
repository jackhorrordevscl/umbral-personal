import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

// Issue #270: motivo obligatorio de la anulación. Queda en el documento
// (voidReason) y en la evidencia del REVOKE automático del ledger.
export class VoidDocumentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
