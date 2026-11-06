import { IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @MaxLength(2048)
  token: string;

  // Issue #627: la contraseña se define al verificar el correo, no al
  // registrarse.
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
