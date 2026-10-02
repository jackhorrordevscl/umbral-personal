import { IsString, MaxLength } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @MaxLength(2048)
  token: string;
}
