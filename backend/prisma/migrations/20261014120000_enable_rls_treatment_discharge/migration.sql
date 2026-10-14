-- La migración 20261011130000_add_treatment_discharge creó la tabla sin RLS.
-- Sin políticas: deny-all para la API REST de Supabase (PostgREST); el backend
-- accede con el rol dueño de la tabla.
ALTER TABLE "TreatmentDischarge" ENABLE ROW LEVEL SECURITY;
