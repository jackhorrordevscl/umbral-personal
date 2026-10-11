import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CustodyType, GuardianRelationship } from '@prisma/client';
import { PersonName } from '../../../common/validators/person-name.decorator';
import { IsRut } from '../../../common/validators/is-rut.decorator';

export class CreateGuardianDto {
  @PersonName(200)
  fullName: string;

  @IsRut()
  rut: string;

  @IsEnum(GuardianRelationship, {
    message: 'Relación con el paciente inválida',
  })
  relationship: GuardianRelationship;

  // Same blank-string handling as CreatePatientDto.email (issue #49): the
  // form sends "" for an empty field.
  @IsOptional()
  @ValidateIf((o: CreateGuardianDto) => o.email !== '')
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isPayer?: boolean;

  @IsOptional()
  @IsBoolean()
  receivesCommunications?: boolean;

  @IsOptional()
  @IsBoolean()
  canAccessReports?: boolean;

  @IsOptional()
  @IsBoolean()
  canConsent?: boolean;

  @IsOptional()
  @IsEnum(CustodyType, { message: 'Tipo de custodia inválido' })
  custody?: CustodyType;

  @IsOptional()
  @IsBoolean()
  hasConflict?: boolean;
}
