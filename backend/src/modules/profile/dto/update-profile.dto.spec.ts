import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

async function validateWebsite(website: unknown) {
  const dto = plainToInstance(UpdateProfileDto, { website });
  const errors = await validate(dto);
  return { dto, errors };
}

describe('UpdateProfileDto.website', () => {
  it('accepts an https URL', async () => {
    const { errors } = await validateWebsite('https://ejemplo.cl/ana');
    expect(errors).toHaveLength(0);
  });

  it('accepts an http URL', async () => {
    const { errors } = await validateWebsite('http://ejemplo.cl');
    expect(errors).toHaveLength(0);
  });

  it('accepts an omitted website', async () => {
    const dto = plainToInstance(UpdateProfileDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts an empty string (clears the field)', async () => {
    const { dto, errors } = await validateWebsite('');
    expect(errors).toHaveLength(0);
    expect(dto.website).toBe('');
  });

  it('treats a whitespace-only string as empty', async () => {
    const { dto, errors } = await validateWebsite('   ');
    expect(errors).toHaveLength(0);
    expect(dto.website).toBe('');
  });

  it('trims surrounding whitespace', async () => {
    const { dto, errors } = await validateWebsite('  https://ejemplo.cl  ');
    expect(errors).toHaveLength(0);
    expect(dto.website).toBe('https://ejemplo.cl');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://ejemplo.cl',
    'file:///etc/passwd',
  ])('rejects the scheme in %s', async (value) => {
    const { errors } = await validateWebsite(value);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a URL without protocol', async () => {
    const { errors } = await validateWebsite('ejemplo.cl');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects free text', async () => {
    const { errors } = await validateWebsite('mi sitio web');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-string value', async () => {
    const { errors } = await validateWebsite(123);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a URL longer than 200 characters', async () => {
    const { errors } = await validateWebsite(
      `https://ejemplo.cl/${'a'.repeat(200)}`,
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateProfileDto.rut y professionalRegistration', () => {
  async function run(payload: Record<string, unknown>) {
    const dto = plainToInstance(UpdateProfileDto, payload);
    return { dto, errors: await validate(dto) };
  }

  it('acepta un RUT con dígito verificador válido, con o sin puntos', async () => {
    expect((await run({ rut: '12.345.678-5' })).errors).toHaveLength(0);
    expect((await run({ rut: '12345678-5' })).errors).toHaveLength(0);
  });

  it('rechaza un RUT con dígito verificador inválido', async () => {
    expect((await run({ rut: '12345678-9' })).errors.length).toBeGreaterThan(0);
  });

  it.each(['abc', '12345678', '1-9-9'])('rechaza el RUT %s', async (rut) => {
    expect((await run({ rut })).errors.length).toBeGreaterThan(0);
  });

  it('trata rut vacío o solo espacios como string vacío (limpia)', async () => {
    const { dto, errors } = await run({ rut: '   ' });
    expect(errors).toHaveLength(0);
    expect(dto.rut).toBe('');
  });

  it('acepta omitir ambos campos', async () => {
    expect((await run({})).errors).toHaveLength(0);
  });

  it('recorta espacios del registro profesional', async () => {
    const { dto, errors } = await run({
      professionalRegistration: '  N° 1234  ',
    });
    expect(errors).toHaveLength(0);
    expect(dto.professionalRegistration).toBe('N° 1234');
  });

  it('acepta un registro profesional vacío (limpia)', async () => {
    const { dto, errors } = await run({ professionalRegistration: '' });
    expect(errors).toHaveLength(0);
    expect(dto.professionalRegistration).toBe('');
  });

  it('rechaza un registro profesional de más de 50 caracteres', async () => {
    const { errors } = await run({ professionalRegistration: 'a'.repeat(51) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('acepta un registro profesional de exactamente 50 caracteres', async () => {
    const { errors } = await run({ professionalRegistration: 'a'.repeat(50) });
    expect(errors).toHaveLength(0);
  });

  it('rechaza caracteres de control en el registro profesional', async () => {
    const { errors } = await run({ professionalRegistration: 'abc\u0000def' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza valores que no son string', async () => {
    expect((await run({ rut: 123 })).errors.length).toBeGreaterThan(0);
    expect(
      (await run({ professionalRegistration: 123 })).errors.length,
    ).toBeGreaterThan(0);
  });
});
