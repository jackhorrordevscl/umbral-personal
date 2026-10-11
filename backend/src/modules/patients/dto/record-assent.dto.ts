import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AssentAction } from '@prisma/client';

// The age band is never accepted from the client: the server derives it from
// the patient's birth date at the moment the event is recorded.
export class RecordAssentDto {
  @IsEnum(AssentAction, { message: 'Acción de asentimiento inválida' })
  action: AssentAction;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'La nota no puede superar los 500 caracteres' })
  note?: string;

  // INFORMED_ASSENT document that backs the event. The service checks that it
  // belongs to the same patient and has not been voided.
  @IsOptional()
  @IsUUID('4', { message: 'Documento inválido' })
  documentId?: string;
}
