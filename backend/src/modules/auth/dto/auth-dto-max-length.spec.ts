import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';
import { SignupDto } from './signup.dto';
import { ResetPasswordDto } from './reset-password.dto';
import { ChangePasswordDto } from './change-password.dto';
import { MfaRecoverDto } from './mfa-recover.dto';
import { MfaSetupBeginDto } from './mfa-setup-begin.dto';
import { MfaSetupConfirmDto } from './mfa-setup-confirm.dto';
import { VerifyEmailDto } from './verify-email.dto';
import { UpdateProfileDto } from '../../profile/dto/update-profile.dto';
import { ConfirmEmailChangeDto } from '../../profile/dto/confirm-email-change.dto';

// Issue #289: sin tope de longitud, un cuerpo de ~100 kB en password o en un
// token obliga a hashear/verificar cadenas enormes (argon2, JWT).
describe('límites de longitud en DTOs de auth y profile', () => {
  const email = 'ana@example.com';
  const largo = (n: number) => 'x'.repeat(n);

  async function propiedadesInvalidas(
    cls: new () => object,
    plain: Record<string, unknown>,
  ) {
    const errors = await validate(plainToInstance(cls, plain));
    return errors.map((e) => e.property);
  }

  it('acepta valores válidos dentro de los límites', async () => {
    expect(
      await propiedadesInvalidas(LoginDto, {
        email,
        password: largo(128),
      }),
    ).toEqual([]);
    expect(
      await propiedadesInvalidas(SignupDto, {
        email,
        password: largo(128),
        name: 'Ana Pérez',
        inviteCode: 'abcdef123456',
      }),
    ).toEqual([]);
  });

  it.each([
    ['LoginDto', LoginDto, { email, password: largo(129) }, 'password'],
    [
      'SignupDto (password)',
      SignupDto,
      { email, password: largo(129), name: 'Ana', inviteCode: 'abc' },
      'password',
    ],
    [
      'SignupDto (inviteCode)',
      SignupDto,
      { email, password: largo(8), name: 'Ana', inviteCode: largo(65) },
      'inviteCode',
    ],
    [
      'ResetPasswordDto (newPassword)',
      ResetPasswordDto,
      { resetToken: 'abc', newPassword: largo(129) },
      'newPassword',
    ],
    [
      'ResetPasswordDto (resetToken)',
      ResetPasswordDto,
      { resetToken: largo(2049), newPassword: largo(8) },
      'resetToken',
    ],
    [
      'ChangePasswordDto (newPassword)',
      ChangePasswordDto,
      { passwordChangeToken: 'abc', newPassword: largo(129) },
      'newPassword',
    ],
    [
      'ChangePasswordDto (passwordChangeToken)',
      ChangePasswordDto,
      { passwordChangeToken: largo(2049), newPassword: largo(8) },
      'passwordChangeToken',
    ],
    [
      'MfaRecoverDto (password)',
      MfaRecoverDto,
      { email, password: largo(129), recoveryCode: 'abc' },
      'password',
    ],
    [
      'MfaRecoverDto (recoveryCode)',
      MfaRecoverDto,
      { email, password: 'abc', recoveryCode: largo(65) },
      'recoveryCode',
    ],
    [
      'MfaSetupBeginDto',
      MfaSetupBeginDto,
      { setupToken: largo(2049) },
      'setupToken',
    ],
    [
      'MfaSetupConfirmDto',
      MfaSetupConfirmDto,
      { setupToken: largo(2049), token: '123456' },
      'setupToken',
    ],
    ['VerifyEmailDto', VerifyEmailDto, { token: largo(2049) }, 'token'],
    [
      'ConfirmEmailChangeDto',
      ConfirmEmailChangeDto,
      { token: largo(2049) },
      'token',
    ],
    [
      'UpdateProfileDto (password)',
      UpdateProfileDto,
      { password: largo(129), currentPassword: 'abc' },
      'password',
    ],
    [
      'UpdateProfileDto (currentPassword)',
      UpdateProfileDto,
      { currentPassword: largo(129) },
      'currentPassword',
    ],
  ])('%s rechaza un valor demasiado largo', async (_n, cls, plain, campo) => {
    expect(await propiedadesInvalidas(cls, plain)).toContain(campo);
  });
});
