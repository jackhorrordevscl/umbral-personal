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
