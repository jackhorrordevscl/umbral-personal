import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ConsentPurpose } from '@prisma/client';

// Issue #131 (T5): declaración retroactiva en bloque para pacientes que ya
// estaban en tratamiento antes de que el consentimiento fuera obligatorio
// (ej: consentimiento en papel del expediente físico, nunca digitalizado).
export class BulkDeclareConsentDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Debe indicar al menos un paciente' })
  @ArrayMaxSize(500, {
    message: 'No se pueden declarar más de 500 pacientes por solicitud',
  })
  @IsUUID('4', { each: true, message: 'Id de paciente inválido' })
  patientIds: string[];

  @IsEnum(ConsentPurpose, { message: 'Finalidad de consentimiento inválida' })
  purpose: ConsentPurpose;

  @IsString()
  @IsNotEmpty({ message: 'Debe indicar la evidencia del consentimiento' })
  @MinLength(10, { message: 'La evidencia debe tener al menos 10 caracteres' })
  @MaxLength(1000)
  evidence: string;
}
