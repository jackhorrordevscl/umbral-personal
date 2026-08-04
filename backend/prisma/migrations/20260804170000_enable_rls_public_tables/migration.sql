-- Supabase reporta "rls_disabled_in_public": cualquier tabla del schema
-- public sin Row-Level Security queda expuesta sin restricciones vía la API
-- REST/GraphQL que Supabase levanta automáticamente sobre Postgres
-- (PostgREST, en https://<project>.supabase.co/rest/v1/<tabla>), accesible
-- con la anon key -- que Supabase trata como pública, no secreta -- ,
-- INDEPENDIENTEMENTE de que esta app nunca use el cliente JS de Supabase
-- (todo el acceso real pasa por Prisma vía DATABASE_URL/DIRECT_URL, nunca
-- por PostgREST). Sin RLS, esa API expone lectura/escritura/borrado directo
-- de datos de pacientes (Ley 20.584) a cualquiera con la anon key.
--
-- Se habilita RLS sin agregar ninguna policy (deny-all por default para los
-- roles `anon`/`authenticated` que usa PostgREST) en las 10 tablas del
-- schema public. Esto NO afecta a esta aplicación: DATABASE_URL/DIRECT_URL
-- conectan como el rol `postgres` de Supabase -- no es superusuario del
-- SO/Postgres (rolsuper=false), pero sí tiene rolbypassrls=true (verificado
-- contra la instancia real antes de aplicar este cambio), que alcanza para
-- que Prisma siga leyendo/escribiendo todo sin importar RLS ni policies.
--
-- `shared_files` usa @@map en schema.prisma (modelo `SharedFile`, tabla real
-- en Postgres `shared_files`) -- el resto de los modelos no tiene @@map, el
-- nombre de tabla coincide con el nombre del modelo.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MfaRecoveryCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Consultation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shared_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsultationHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientConsent" ENABLE ROW LEVEL SECURITY;

-- "AuditLog" es distinta: la migración 20260803060000 (issue #52) le sacó
-- deliberadamente la ownership al rol de runtime y se la dio a un rol
-- separado (`audit_log_owner`), justo para que ni la app ni sus
-- credenciales puedan alterar la tabla (evita desactivar el trigger
-- append-only). `ENABLE ROW LEVEL SECURITY` exige ser el dueño, así que
-- hace falta el mismo procedimiento documentado ahí: otorgar membership
-- temporal, aplicar el cambio, revocarla de nuevo -- sin tocar el resto de
-- los GRANT/REVOKE que ya la protegen (rolbypassrls=true en el rol de
-- runtime hace que esto no le cambie nada a la app: sigue viendo/insertando
-- igual que antes, RLS habilitado o no).
DO $$
DECLARE
  runtime_role text := current_user;
BEGIN
  EXECUTE format('GRANT audit_log_owner TO %I', runtime_role);
  EXECUTE 'ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY';
  EXECUTE format('REVOKE audit_log_owner FROM %I', runtime_role);
END $$;
