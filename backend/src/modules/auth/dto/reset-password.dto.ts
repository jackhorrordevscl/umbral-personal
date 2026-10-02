import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MaxLength(2048)
  resetToken: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
