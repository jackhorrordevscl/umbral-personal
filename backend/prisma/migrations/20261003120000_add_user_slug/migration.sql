-- Slug público del terapeuta (link de la agenda: /book/<slug>).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "slug" TEXT;

-- Backfill de los profesionales existentes. Misma regla que slugify() en
-- src/common/utils/slug.util.ts: minúsculas, sin tildes, kebab-case, máximo 60
-- caracteres, 'terapeuta' si no queda nada. Las colisiones reciben -2, -3...
-- en orden de antigüedad (el más antiguo conserva el slug base). Se recorre
-- fila por fila para que un sufijo generado tampoco choque con el slug natural
-- de otra cuenta (p. ej. "Ana 2" frente a la segunda "Ana"). Sin extensión
-- unaccent: translate() cubre las letras del español.
DO $$
DECLARE
  u RECORD;
  base text;
  candidate text;
  suffix integer;
BEGIN
  FOR u IN
    SELECT "id", "name"
    FROM "User"
    WHERE "role" = 'PROFESSIONAL' AND "deletedAt" IS NULL
    ORDER BY "createdAt", "id"
  LOOP
    base := translate(
      lower(u."name"),
      'áàäâãåéèëêíìïîóòöôõúùüûñç',
      'aaaaaaeeeeiiiiooooouuuunc'
    );
    base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
    base := btrim(base, '-');
    base := btrim(left(base, 60), '-');
    IF base = '' THEN
      base := 'terapeuta';
    END IF;

    candidate := base;
    suffix := 2;
    WHILE EXISTS (SELECT 1 FROM "User" WHERE "slug" = candidate) LOOP
      candidate := base || '-' || suffix;
      suffix := suffix + 1;
    END LOOP;

    UPDATE "User" SET "slug" = candidate WHERE "id" = u."id";
  END LOOP;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "User_slug_key" ON "User"("slug");
