import { NormalizedEmail } from '../../../common/validators/normalized-email.decorator';

export class ForgotPasswordDto {
  @NormalizedEmail()
  email: string;
}
