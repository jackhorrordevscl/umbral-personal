import { IsEnum, IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ConsentPurpose, ConsentAction } from '@prisma/client';

export class RecordConsentDto {
  @IsEnum(ConsentPurpose, { message: 'Finalidad de consentimiento inválida' })
  purpose: ConsentPurpose;

  @IsEnum(ConsentAction, { message: 'Acción de consentimiento inválida' })
  action: ConsentAction;

  @IsString()
  @IsNotEmpty({ message: 'Debe indicar la evidencia del consentimiento' })
  @MinLength(10, { message: 'La evidencia debe tener al menos 10 caracteres' })
  evidence: string;
}
