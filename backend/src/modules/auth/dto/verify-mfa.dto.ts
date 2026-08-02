import { IsString, Length } from 'class-validator';

export class VerifyMfaDto {
  @IsString()
  @Length(6, 6)
  token: string;

  @IsString()
  userId: string;
}