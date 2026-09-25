import { PartialType } from '@nestjs/mapped-types';
import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';
import { CreatePatientDto } from './create-patient.dto';

export class UpdatePatientDto extends PartialType(CreatePatientDto) {
  @IsString()
  @IsNotEmpty({ message: 'Debe indicar el motivo de la modificación' })
  @MinLength(10, { message: 'El motivo debe tener al menos 10 caracteres' })
  @MaxLength(500)
  reason: string;
}
