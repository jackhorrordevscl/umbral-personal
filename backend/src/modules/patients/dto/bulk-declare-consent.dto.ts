import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { ConsentPurpose } from '@prisma/client';

// Issue #131 (T5): declaración retroactiva en bloque para pacientes que ya
// estaban en tratamiento antes de que el consentimiento fuera obligatorio
// (ej: consentimiento en papel del expediente físico, nunca digitalizado).
export class BulkDeclareConsentDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Debe indicar al menos un paciente' })
  @IsUUID('4', { each: true, message: 'Id de paciente inválido' })
  patientIds: string[];

  @IsEnum(ConsentPurpose, { message: 'Finalidad de consentimiento inválida' })
  purpose: ConsentPurpose;

  @IsString()
  @IsNotEmpty({ message: 'Debe indicar la evidencia del consentimiento' })
  @MinLength(10, { message: 'La evidencia debe tener al menos 10 caracteres' })
  evidence: string;
}
