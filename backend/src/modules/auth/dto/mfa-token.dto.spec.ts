import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MfaTokenDto } from './mfa-token.dto';

// Issue #194: mfa/enable y mfa/disable leían @Body('token') sin validar, así
// que un body no-string llegaba crudo a speakeasy.totp.verify.
describe('MfaTokenDto', () => {
  it('acepta un código de 6 caracteres', async () => {
    const dto = plainToInstance(MfaTokenDto, { token: '123456' });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['numérico', 123456],
    ['objeto', { $ne: '' }],
    ['arreglo', ['123456']],
    ['ausente', undefined],
    ['corto', '12345'],
    ['largo', '1234567'],
  ])('rechaza un token %s', async (_label, token) => {
    const dto = plainToInstance(MfaTokenDto, { token });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
