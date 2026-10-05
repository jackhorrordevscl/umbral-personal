import { generateUniqueSlug, isUuid, slugify } from './slug.util';

describe('slugify', () => {
  it('pasa a minúsculas, quita tildes y usa guiones', () => {
    expect(slugify('Juan José Martínez')).toBe('juan-jose-martinez');
  });

  it('maneja ñ, diéresis y símbolos', () => {
    expect(slugify('  Ñandú  Güemes!! (Psic.) ')).toBe('nandu-guemes-psic');
  });

  it('colapsa separadores repetidos y recorta guiones de los bordes', () => {
    expect(slugify('--Ana   --  María--')).toBe('ana-maria');
  });

  it('usa un valor por defecto cuando no quedan caracteres válidos', () => {
    expect(slugify('***')).toBe('terapeuta');
    expect(slugify('')).toBe('terapeuta');
  });

  it('acota el largo y no deja un guion final tras cortar', () => {
    const slug = slugify(`${'a'.repeat(59)} bbbbbb`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('isUuid', () => {
  it('reconoce un UUID y rechaza un slug', () => {
    expect(isUuid('35a86f8b-0a4e-4f43-9b9e-0c1d2e3f4a5b')).toBe(true);
    expect(isUuid('juan-jose-martinez')).toBe(false);
  });
});

describe('generateUniqueSlug', () => {
  const clientWith = (taken: string[]) => ({
    user: {
      findMany: jest.fn().mockResolvedValue(taken.map((slug) => ({ slug }))),
    },
  });

  it('devuelve el slug base si está libre', async () => {
    const client = clientWith([]);
    await expect(generateUniqueSlug(client, 'Ana Pérez')).resolves.toBe(
      'ana-perez',
    );
  });

  it('agrega -2, -3... ante colisiones', async () => {
    await expect(
      generateUniqueSlug(clientWith(['ana-perez']), 'Ana Pérez'),
    ).resolves.toBe('ana-perez-2');
    await expect(
      generateUniqueSlug(clientWith(['ana-perez', 'ana-perez-2']), 'Ana Pérez'),
    ).resolves.toBe('ana-perez-3');
  });

  it('excluye al propio usuario al buscar colisiones', async () => {
    const client = clientWith([]);
    await generateUniqueSlug(client, 'Ana Pérez', 'user-1');
    expect(client.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { not: 'user-1' },
        OR: [{ slug: 'ana-perez' }, { slug: { startsWith: 'ana-perez-' } }],
      },
      select: { slug: true },
    });
  });
});
