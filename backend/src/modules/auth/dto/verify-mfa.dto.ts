import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class VerifyMfaDto {
  @IsString()
  @Length(6, 6)
  token: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  mfaToken: string;
}
