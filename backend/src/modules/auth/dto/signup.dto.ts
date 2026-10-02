import { NormalizedEmail } from '../../../common/validators/normalized-email.decorator';
import { PersonName } from '../../../common/validators/person-name.decorator';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @NormalizedEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @PersonName(200)
  @MinLength(1)
  name: string;

  // Issue #124: signup público sin invitación. Sin este código (emitido por
  // AuthService.createInvitation) no se puede crear cuenta -- ver
  // AuthService.signup.
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  inviteCode: string;
}
