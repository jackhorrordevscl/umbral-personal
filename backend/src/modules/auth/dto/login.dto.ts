import { NormalizedEmail } from '../../../common/validators/normalized-email.decorator';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @NormalizedEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
