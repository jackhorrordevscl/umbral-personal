import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(1)
  name: string;

  // Issue #124: signup público sin invitación. Sin este código (emitido por
  // AuthService.createInvitation) no se puede crear cuenta -- ver
  // AuthService.signup.
  @IsString()
  @IsNotEmpty()
  inviteCode: string;
}
