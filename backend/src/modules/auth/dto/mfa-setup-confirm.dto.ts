import { IsString, Length } from 'class-validator';

export class MfaSetupConfirmDto {
  @IsString()
  setupToken: string;

  @IsString()
  @Length(6, 6)
  token: string;
}
