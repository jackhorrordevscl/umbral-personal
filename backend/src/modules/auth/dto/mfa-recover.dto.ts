import { NormalizedEmail } from '../../../common/validators/normalized-email.decorator';
import { IsString } from 'class-validator';

export class MfaRecoverDto {
  @NormalizedEmail()
  email: string;

  @IsString()
  password: string;

  @IsString()
  recoveryCode: string;
}
