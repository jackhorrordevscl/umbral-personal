import { OmitType, PartialType } from '@nestjs/mapped-types';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';
import { IsRutFormat } from '../../../common/validators/is-rut.decorator';
import { CreatePatientDto } from './create-patient.dto';

export class UpdatePatientDto extends PartialType(
  OmitType(CreatePatientDto, ['rut'] as const),
) {
  // Issue #289: en la edición el RUT solo se valida por forma; el dígito
  // verificador lo exige PatientsService.update únicamente cuando el RUT cambia,
  // para no bloquear la edición de fichas existentes con un DV inválido.
  @IsOptional()
  @IsRutFormat()
  rut?: string;

  @IsString()
  @IsNotEmpty({ message: 'Debe indicar el motivo de la modificación' })
  @MinLength(10, { message: 'El motivo debe tener al menos 10 caracteres' })
  @MaxLength(500)
  reason: string;
}
