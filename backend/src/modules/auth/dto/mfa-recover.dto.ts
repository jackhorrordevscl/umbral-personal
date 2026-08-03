import { IsEmail, IsString } from 'class-validator';

export class MfaRecoverDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsString()
  recoveryCode: string;
}
