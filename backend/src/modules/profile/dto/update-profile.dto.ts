import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  // Issue #76: step-up auth. Obligatoria (chequeado en ProfileService, no acá
  // -- class-validator no puede expresar "requerido solo si email o password
  // vienen presentes") cuando la request trae `email` y/o `password`; los
  // updates de solo `name` no la necesitan.
  @IsOptional()
  @IsString()
  currentPassword?: string;
}
