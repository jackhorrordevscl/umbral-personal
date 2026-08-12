-- Supabase reporta "function_search_path_mutable" para
-- prevent_audit_log_mutation() (creada en la migración
-- 20260715002944_audit_log_append_only_trigger): la función no fijaba
-- search_path, así que resolvía nombres sin schema-qualificar contra el
-- search_path de la sesión que la invoca, no contra uno fijo.
--
-- El riesgo real acá es bajo -- la función solo hace RAISE EXCEPTION, no
-- referencia ninguna tabla/objeto por nombre -- pero se fija igual siguiendo
-- la recomendación del linter (0011): cualquier función SECURITY DEFINER o
-- ejecutada por un trigger debería fijar su propio search_path para no
-- depender del que tenga la sesión que la dispara.
--
-- `SET search_path = ''` fuerza a que cualquier referencia futura a un
-- objeto sin schema-qualificar falle en vez de resolverse contra un schema
-- inesperado. CREATE OR REPLACE conserva el mismo cuerpo y el trigger
-- existente (trg_audit_log_append_only) sigue apuntando a esta función sin
-- necesidad de recrearlo.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog es append-only: % no está permitido (id=%)',
    TG_OP,
    COALESCE(OLD.id, 'desconocido');
END;
$$;
