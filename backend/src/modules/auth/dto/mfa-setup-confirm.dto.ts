import { IsString, Length, MaxLength } from 'class-validator';

export class MfaSetupConfirmDto {
  @IsString()
  @MaxLength(2048)
  setupToken: string;

  @IsString()
  @Length(6, 6)
  token: string;
}
