import { NormalizedEmail } from '../../../common/validators/normalized-email.decorator';
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @NormalizedEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
