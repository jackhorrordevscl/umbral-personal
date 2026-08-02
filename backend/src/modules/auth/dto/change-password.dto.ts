import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  passwordChangeToken: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
