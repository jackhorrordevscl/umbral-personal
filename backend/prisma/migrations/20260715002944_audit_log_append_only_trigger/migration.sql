-- AuditLog debe ser append-only: ni siquiera las credenciales de la
-- aplicación pueden modificar o eliminar un registro ya escrito.
-- Antes de esto, "inmutable" era solo una convención de código
-- (AuditService.log solo hace .create()), sin ningún control real a
-- nivel de base de datos.

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog es append-only: % no está permitido (id=%)',
    TG_OP,
    COALESCE(OLD.id, 'desconocido');
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_append_only
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_mutation();
