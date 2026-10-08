import {
  IsEnum,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsUUID,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ConsentPurpose, ConsentAction, ConsentGrantor } from '@prisma/client';

export class RecordConsentDto {
  @IsEnum(ConsentPurpose, { message: 'Finalidad de consentimiento inválida' })
  purpose: ConsentPurpose;

  @IsEnum(ConsentAction, { message: 'Acción de consentimiento inválida' })
  action: ConsentAction;

  @IsString()
  @IsNotEmpty({ message: 'Debe indicar la evidencia del consentimiento' })
  @MinLength(10, { message: 'La evidencia debe tener al menos 10 caracteres' })
  @MaxLength(1000)
  evidence: string;

  // Who gave the consent. Defaults to PATIENT; a patient under 18 needs
  // GUARDIAN (+ guardianId) for a GRANT. The service enforces the rules that
  // depend on the patient's age.
  @IsOptional()
  @IsEnum(ConsentGrantor, { message: 'Otorgante de consentimiento inválido' })
  grantedBy?: ConsentGrantor;

  @IsOptional()
  @IsUUID('4', { message: 'Representante inválido' })
  guardianId?: string;
}
