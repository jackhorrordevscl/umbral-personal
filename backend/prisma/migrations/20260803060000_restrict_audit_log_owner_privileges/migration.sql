-- Issue #52: el trigger append-only (`trg_audit_log_append_only`, migración
-- 20260715002944) impide MODIFICAR o BORRAR una fila ya escrita en
-- "AuditLog", pero no impide que las mismas credenciales usadas en el
-- procedimiento de recuperación manual de cuenta lo desactiven
-- (`ALTER TABLE ... DISABLE TRIGGER`, `DROP TRIGGER`) antes de operar y lo
-- reactiven después sin dejar rastro -- porque hasta ahora el rol de
-- runtime de la app ERA el dueño de la tabla, y el dueño tiene esos
-- permisos implícitos sin importar los GRANT/REVOKE.
--
-- Primer intento descartado: un event trigger a nivel de base que bloqueara
-- ese DDL, sin importar el rol. `CREATE EVENT TRIGGER` requiere privilegios
-- de superusuario en Postgres -- verificado contra el rol real de
-- producción (`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`)
-- que da `false`. Ese enfoque no es viable en Supabase, ni en staging ni en
-- producción: no es un problema de ambiente, es un techo de la plataforma.
--
-- Enfoque real: separar la ownership de "AuditLog" a un rol nuevo
-- (`audit_log_owner`) sin LOGIN, y dejar que el rol de runtime (el que usa
-- `DATABASE_URL`/`DIRECT_URL`) solo tenga SELECT + INSERT explícitos, sin
-- ALTER/TRIGGER/UPDATE/DELETE. Esto no necesita superusuario, solo que el
-- rol que corre la migración tenga CREATEROLE (verificado con
-- `SELECT rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname =
-- current_user` -> true).
--
-- Verificado end-to-end contra un cluster Postgres local descartable con un
-- rol sin superusuario pero con CREATEROLE/CREATEDB (mismo perfil que el
-- rol real de producción):
--   - ALTER TABLE ... DISABLE TRIGGER  -> "ERROR: debe ser dueño de la tabla"
--   - DROP TRIGGER                      -> "ERROR: debe ser dueño de la relación"
--   - SET ROLE audit_log_owner          -> "ERROR: permiso denegado" (sin
--     membership, no hay forma de asumir los privilegios del dueño)
--   - UPDATE / DELETE                   -> bloqueados por permisos, ni
--     siquiera llegan a evaluar el trigger append-only
--   - INSERT / SELECT (lo único que usa AuditService.log())  -> funcionan
--     sin fricción
--
-- Nota operativa: una futura migración legítima que necesite alterar la
-- estructura de "AuditLog" (ej. agregar una columna) va a fallar con este
-- mismo rol, porque ya no es el dueño -- va a requerir un paso manual
-- documentado (otorgar membership de `audit_log_owner` temporalmente,
-- aplicar el cambio, revocarla de nuevo), no un `prisma migrate deploy`
-- automático sin intervención.

DO $$
DECLARE
  runtime_role text := current_user;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_log_owner') THEN
    EXECUTE 'CREATE ROLE audit_log_owner NOLOGIN';
  END IF;

  -- ALTER TABLE ... OWNER TO exige que el nuevo dueño tenga CREATE en el
  -- schema al momento de la transferencia; no queda como privilegio
  -- permanente, se revoca más abajo.
  EXECUTE 'GRANT CREATE ON SCHEMA public TO audit_log_owner';
  EXECUTE format('GRANT audit_log_owner TO %I', runtime_role);
  EXECUTE 'ALTER TABLE "AuditLog" OWNER TO audit_log_owner';

  -- Mientras runtime_role todavía es miembro (INHERIT) de audit_log_owner,
  -- hereda los privilegios implícitos del dueño y puede ajustar sus propios
  -- grants explícitos antes de perder esa membership.
  EXECUTE format('REVOKE ALL ON "AuditLog" FROM %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT ON "AuditLog" TO %I', runtime_role);

  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM audit_log_owner';
  EXECUTE format('REVOKE audit_log_owner FROM %I', runtime_role);
END $$;
