import { NormalizedEmail } from '../../../common/validators/normalized-email.decorator';

export class ResendVerificationDto {
  @NormalizedEmail()
  email: string;
}
