import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;

  // Issue #155: perfil público mostrado en la autoagenda (PublicBookingPage)
  // -- 500 caracteres alcanza para una bio corta sin habilitar abuso (spam,
  // payloads grandes) en un campo que termina expuesto sin autenticación vía
  // GET /public/therapists/:id/profile.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  specialty?: string;

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
