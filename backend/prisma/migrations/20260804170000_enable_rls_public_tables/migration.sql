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
-- conectan como el rol `postgres` (superusuario de Supabase), y los
-- superusuarios de Postgres bypasean RLS siempre, sin importar si está
-- habilitado o si hay policies -- confirmado antes de aplicar este cambio.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MfaRecoveryCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Consultation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SharedFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsultationHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientConsent" ENABLE ROW LEVEL SECURITY;
