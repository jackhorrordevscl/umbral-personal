import { IsString } from 'class-validator';

export class MfaSetupBeginDto {
  @IsString()
  setupToken: string;
}
