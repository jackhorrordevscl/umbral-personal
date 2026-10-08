import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateGuardianDto } from './create-guardian.dto';
import { UpdateGuardianDto } from './update-guardian.dto';

describe('CreateGuardianDto', () => {
  const valid = {
    fullName: 'María Soto',
    rut: '12345678-5',
    relationship: 'MOTHER',
  };

  it('acepta solo los campos obligatorios', async () => {
    const dto = plainToInstance(CreateGuardianDto, valid);

    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta todos los campos opcionales', async () => {
    const dto = plainToInstance(CreateGuardianDto, {
      ...valid,
      email: 'maria@example.com',
      phone: '+56911112222',
      isPayer: true,
      receivesCommunications: false,
      canAccessReports: true,
      canConsent: true,
      custody: 'SHARED',
      hasConflict: false,
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('recorta espacios del nombre', async () => {
    const dto = plainToInstance(CreateGuardianDto, {
      ...valid,
      fullName: '  María Soto  ',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.fullName).toBe('María Soto');
  });

  it('rechaza un RUT con dígito verificador inválido', async () => {
    const dto = plainToInstance(CreateGuardianDto, {
      ...valid,
      rut: '12345678-9',
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toContain('rut');
  });

  it('rechaza una relación fuera del enum', async () => {
    const dto = plainToInstance(CreateGuardianDto, {
      ...valid,
      relationship: 'UNCLE',
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toContain('relationship');
  });

  it('rechaza una custodia fuera del enum', async () => {
    const dto = plainToInstance(CreateGuardianDto, {
      ...valid,
      custody: 'NONE',
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toContain('custody');
  });

  it('rechaza un email inválido', async () => {
    const dto = plainToInstance(CreateGuardianDto, {
      ...valid,
      email: 'no-es-un-email',
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toContain('email');
  });

  it('acepta un email vacío (el formulario manda "" cuando queda en blanco)', async () => {
    const dto = plainToInstance(CreateGuardianDto, { ...valid, email: '' });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['fullName', 'phone'])('rechaza %s de 5000 caracteres', async (f) => {
    const dto = plainToInstance(CreateGuardianDto, {
      ...valid,
      [f]: 'x'.repeat(5000),
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toContain(f);
  });

  it('rechaza un email de 300 caracteres', async () => {
    const dto = plainToInstance(CreateGuardianDto, {
      ...valid,
      email: `${'a'.repeat(300)}@example.com`,
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it.each([
    'isPayer',
    'receivesCommunications',
    'canAccessReports',
    'canConsent',
    'hasConflict',
  ])('rechaza %s que no es booleano', async (field) => {
    const dto = plainToInstance(CreateGuardianDto, {
      ...valid,
      [field]: 'yes',
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toContain(field);
  });

  it.each(['fullName', 'rut', 'relationship'])('exige %s', async (field) => {
    const { [field]: _omitted, ...rest } = valid as Record<string, string>;
    void _omitted;
    const dto = plainToInstance(CreateGuardianDto, rest);

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toContain(field);
  });
});

describe('UpdateGuardianDto', () => {
  it('acepta un cuerpo vacío (todo opcional)', async () => {
    const dto = plainToInstance(UpdateGuardianDto, {});

    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta un cambio parcial', async () => {
    const dto = plainToInstance(UpdateGuardianDto, { canConsent: false });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('valida el RUT cuando viene', async () => {
    const dto = plainToInstance(UpdateGuardianDto, { rut: '12345678-9' });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toContain('rut');
  });
});
