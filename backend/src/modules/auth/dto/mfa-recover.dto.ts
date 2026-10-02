import { NormalizedEmail } from '../../../common/validators/normalized-email.decorator';
import { IsString, MaxLength } from 'class-validator';

export class MfaRecoverDto {
  @NormalizedEmail()
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;

  @IsString()
  @MaxLength(64)
  recoveryCode: string;
}
