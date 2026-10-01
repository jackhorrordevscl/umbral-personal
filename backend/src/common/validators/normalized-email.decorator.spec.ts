import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignupDto } from '../../modules/auth/dto/signup.dto';
import { LoginDto } from '../../modules/auth/dto/login.dto';
import { ForgotPasswordDto } from '../../modules/auth/dto/forgot-password.dto';
import { ResendVerificationDto } from '../../modules/auth/dto/resend-verification.dto';
import { MfaRecoverDto } from '../../modules/auth/dto/mfa-recover.dto';
import { UpdateProfileDto } from '../../modules/profile/dto/update-profile.dto';
import { normalizeEmail } from '../utils/normalize-email.util';

// Issue #303: todo DTO con email lo recorta y lo pasa a minúsculas.
const cases: Array<[string, (email: unknown) => object]> = [
  [
    'SignupDto',
    (email) =>
      plainToInstance(SignupDto, {
        email,
        password: '12345678',
        name: 'Ana',
        inviteCode: 'abc',
      }),
  ],
  [
    'LoginDto',
    (email) => plainToInstance(LoginDto, { email, password: '12345678' }),
  ],
  [
    'ForgotPasswordDto',
    (email) => plainToInstance(ForgotPasswordDto, { email }),
  ],
  [
    'ResendVerificationDto',
    (email) => plainToInstance(ResendVerificationDto, { email }),
  ],
  [
    'MfaRecoverDto',
    (email) =>
      plainToInstance(MfaRecoverDto, {
        email,
        password: '12345678',
        recoveryCode: 'abcd',
      }),
  ],
  ['UpdateProfileDto', (email) => plainToInstance(UpdateProfileDto, { email })],
];

describe('NormalizedEmail', () => {
  it.each(cases)(
    '%s recorta y pasa a minúsculas el email',
    async (_n, build) => {
      const dto = build('  Ana.Perez@Example.CL ') as { email: string };

      expect(dto.email).toBe('ana.perez@example.cl');
      const errors = (
        await validate(dto, { skipMissingProperties: true })
      ).filter((e) => e.property === 'email');
      expect(errors).toHaveLength(0);
    },
  );

  it.each(cases)('%s sigue rechazando un email inválido', async (_n, build) => {
    const dto = build('no-es-un-email');

    const errors = (await validate(dto)).filter((e) => e.property === 'email');
    expect(errors).toHaveLength(1);
  });

  it('deja intactos los valores que no son string (los rechaza IsEmail)', async () => {
    const dto = plainToInstance(LoginDto, { email: 42, password: '12345678' });

    expect(dto.email).toBe(42 as unknown as string);
    const errors = (await validate(dto)).filter((e) => e.property === 'email');
    expect(errors).toHaveLength(1);
  });

  it('normalizeEmail es idempotente', () => {
    expect(normalizeEmail(normalizeEmail(' A@B.cl '))).toBe('a@b.cl');
  });
});
