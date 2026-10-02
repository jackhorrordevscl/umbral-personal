import { IsString, MaxLength } from 'class-validator';

export class MfaSetupBeginDto {
  @IsString()
  @MaxLength(2048)
  setupToken: string;
}
