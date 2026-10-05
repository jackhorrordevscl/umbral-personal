// Slug público del terapeuta (link de la agenda pública: /book/<slug>).
// Se deriva del nombre: minúsculas, sin tildes, separado por guiones. La
// migración 20261003120000_add_user_slug aplica la misma regla en SQL para los
// usuarios existentes; si cambia una, hay que cambiar la otra.

const DEFAULT_SLUG = 'terapeuta';
const MAX_SLUG_LENGTH = 60;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return slug || DEFAULT_SLUG;
}

// Subconjunto estructural de PrismaService / TransactionClient, para poder
// usarlo dentro o fuera de una transacción.
export interface SlugLookupClient {
  user: {
    findMany(args: {
      where: {
        id?: { not: string };
        OR: Array<{ slug: string | { startsWith: string } }>;
      };
      select: { slug: true };
    }): Promise<Array<{ slug: string | null }>>;
  };
}

// Devuelve el slug base del nombre o, si ya lo usa otro usuario (incluso
// dado de baja: el índice único los cubre), base-2, base-3, etc.
// `excludeUserId` evita que el propio usuario cuente como colisión al
// regenerar. Entre la lectura y el write puede colarse otra alta con el mismo
// slug; ese caso lo frena el índice único (P2002) en el caller.
export async function generateUniqueSlug(
  client: SlugLookupClient,
  name: string,
  excludeUserId?: string,
): Promise<string> {
  const base = slugify(name);
  const rows = await client.user.findMany({
    where: {
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }],
    },
    select: { slug: true },
  });
  const taken = new Set(rows.map((row) => row.slug));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
