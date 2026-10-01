-- Issue #303: canonical emails (trimmed, lowercase). The application now
-- normalizes every email before lookup/insert, so existing rows must match.

-- Abort (before touching any row) if two accounts would collapse into the
-- same canonical email: the unique index on "User"."email" would fail halfway
-- otherwise, and merging accounts is a manual decision, never automatic.
-- Soft-deleted rows are included on purpose: the unique index covers them too.
DO $$
DECLARE
  collisions text;
BEGIN
  SELECT string_agg(canonical_email || ' (' || accounts || ' accounts)', ', ')
    INTO collisions
  FROM (
    SELECT lower(btrim("email")) AS canonical_email, count(*) AS accounts
    FROM "User"
    GROUP BY lower(btrim("email"))
    HAVING count(*) > 1
  ) AS duplicated;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot normalize "User"."email": case/whitespace-only duplicates exist: %. Resolve them manually and re-run the migration.',
      collisions;
  END IF;
END $$;

-- UpdateTable
UPDATE "User"
SET "email" = lower(btrim("email"))
WHERE "email" <> lower(btrim("email"));

-- Pending email-change targets have no unique constraint of their own.
UPDATE "User"
SET "pendingEmail" = lower(btrim("pendingEmail"))
WHERE "pendingEmail" IS NOT NULL
  AND "pendingEmail" <> lower(btrim("pendingEmail"));
