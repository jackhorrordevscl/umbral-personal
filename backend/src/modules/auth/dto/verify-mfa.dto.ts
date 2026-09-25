import { IsString, IsUUID, Length } from 'class-validator';

export class VerifyMfaDto {
  @IsString()
  @Length(6, 6)
  token: string;

  @IsUUID('4')
  userId: string;
}
