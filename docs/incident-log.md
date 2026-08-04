# Registro de incidentes de seguridad

Bitácora de incidentes de seguridad reales detectados y resueltos durante el
desarrollo de Umbral. Existe como documento dedicado (issue #69) porque antes
estas narrativas vivían dispersas — dos como texto suelto en `README.md`, una
tercera solo como comentario de una línea en `.gitignore` — sin un lugar
único donde una revisión de compliance (CENS) pudiera encontrarlas.

Formato por incidente: qué pasó, impacto real, causa raíz, remediación,
verificación, y qué cambió para que no vuelva a pasar.

---

## 2026-08-02/03 — Dumps de Postgres sin cifrar committeados en el historial de git

**Qué pasó.** El script `backup.sh` legacy (retirado en issue #61) escribía
sus dumps directo a `backups/files/`, una carpeta dentro del working tree del
repo. Desde marzo de 2026, 4 dumps `.sql.gz` **sin cifrar** (no
`.sql.gz.enc`) quedaron committeados ahí — el `.gitignore` de la época no
cubría esa ruta.

**Impacto.** El esquema de esos dumps incluía `User.passwordHash` y PII/PHI
de `Patient`/`Consultation`. Confirmado por el dueño del proyecto: eran datos
de prueba sin valor real (el proyecto recién arrancaba en esa fecha) — no
hubo exposición de datos de pacientes reales.

**Causa raíz.** Un script de backup que escribe dumps directo a una ruta
trackeada por git, combinado con un `.gitignore` que no anticipaba esa ruta.

**Remediación.** Se purgaron los 4 archivos de **todo** el historial de git
(no solo el working tree actual):

```bash
git filter-branch --index-filter \
  "git rm --cached --ignore-unmatch -r backups/files" \
  --prune-empty --tag-name-filter cat -- --all
git gc --prune=now --aggressive
git push origin --force --all
```

**Verificación.** `git rev-list --objects --all | grep backups/files` → sin
resultados: ningún objeto del historial (ni siquiera en commits antiguos o
tags) sigue referenciando esos archivos.

**Qué cambió.**
- `backups/files/` se agregó a `.gitignore` (ver comentario ahí).
- Precedente para issue #57 (tercera copia local, regla 3-2-1): el destino
  de esa copia se gitignoreó desde el diseño inicial, no como parche
  posterior.
- Si `backup.sh` se retoma (issue #61, abierto), tiene que escribir a una
  ruta gitignoreada desde el primer commit que lo reintroduzca.

---

## 2026-08-03 — `AuditLog` no estaba protegido contra manipulación por el propio rol de runtime (issue #52)

**Qué pasó.** El procedimiento de reset manual de cuenta (último recurso
cuando se pierden contraseña y los 10 códigos de recuperación a la vez) deja
constancia en `AuditLog` como paso obligatorio del runbook. `AuditLog` tenía
un trigger `trg_audit_log_append_only` que bloqueaba `UPDATE`/`DELETE` sobre
filas ya escritas — pero **no** impedía que las mismas credenciales usadas
para ese procedimiento manual deshabilitaran el trigger
(`ALTER TABLE ... DISABLE TRIGGER` / `DROP TRIGGER`), hicieran el reset sin
dejar el paso de auditoría, y lo reactivaran después sin rastro. La causa:
el rol de runtime de la app era el **dueño** de la tabla, y el dueño de una
tabla en Postgres tiene esos permisos implícitos sin importar los
`GRANT`/`REVOKE` explícitos.

**Impacto.** Riesgo de manipulación silenciosa de la bitácora de auditoría
por cualquiera con las credenciales de runtime de la app — exactamente el
escenario que un log de auditoría append-only debería impedir. No hay
evidencia de que se haya explotado; se detectó en revisión de diseño, no en
un incidente activo.

**Primer intento descartado.** Un *event trigger* a nivel de base que
bloqueara ese DDL sin importar el rol. `CREATE EVENT TRIGGER` requiere
privilegios de superusuario en Postgres — verificado contra el rol real de
producción (`SELECT rolsuper FROM pg_roles WHERE rolname = current_user` →
`false`). No viable en Supabase, ni en staging ni en producción: es un techo
de la plataforma, no un problema de configuración.

**Remediación real.** Migración
`20260803060000_restrict_audit_log_owner_privileges`: se transfiere la
ownership de `"AuditLog"` a un rol nuevo sin login (`audit_log_owner`), y el
rol de runtime queda con `SELECT`/`INSERT` explícitos únicamente — sin
`ALTER`/`TRIGGER`/`UPDATE`/`DELETE`. No necesita superusuario, solo que el
rol que corre la migración tenga `CREATEROLE`.

**Verificación.** Probado end-to-end contra un cluster Postgres local
descartable con un rol sin superusuario pero con ese mismo perfil de
privilegios: `ALTER TABLE ... DISABLE TRIGGER` y `DROP TRIGGER` fallan por no
ser dueño, `SET ROLE audit_log_owner` falla por no tener membership (no hay
forma de asumir los privilegios del dueño), `UPDATE`/`DELETE` quedan
bloqueados por permisos (ni siquiera llegan a evaluar el trigger), e
`INSERT`/`SELECT` (lo único que usa `AuditService.log()`) siguen funcionando
sin fricción.

**Qué cambió.** Nota operativa permanente: una futura migración legítima que
necesite alterar la estructura de `"AuditLog"` (ej. agregar una columna) va a
fallar con el rol de runtime actual porque ya no es el dueño — requiere un
paso manual documentado (otorgar membership de `audit_log_owner`
temporalmente, aplicar el cambio, revocarla de nuevo), no un
`prisma migrate deploy` automático sin intervención.

---

## 2026-08-03 — Verificación real de restauración de backup offsite (issue #56)

**Qué se verificó.** Que el backup offsite cifrado (Backblaze B2, ver
[Configuración de Backups](../README.md#configuración-de-backups)) efectivamente
sirve para restaurar, no solo para subirse sin errores. No es un incidente en
el sentido de una falla real, pero se documenta acá como evidencia de
verificación de un control de continuidad — el tipo de evidencia que una
revisión CENS/ISMS pide.

**Procedimiento.** Se bajó el `.sql.gz.enc` real más reciente de B2, se
desencriptó y se restauró contra un Postgres local descartable (nunca contra
producción).

**Resultado.** Las 11 tablas de `schema.prisma` restauraron con datos
correctos, incluida `_prisma_migrations` con las 21 migraciones aplicadas. El
trigger `trg_audit_log_append_only` siguió bloqueando `UPDATE` después de
restaurar. El dump completo arrastra ~600 errores esperables de
roles/extensiones internas de Supabase (`supabase_admin`, `dashboard_user`,
`vault`, `pgbouncer`, etc.) que no existen fuera de su infraestructura — no
son un problema: `psql -f` los saltea y sigue con el resto del archivo.

**Por qué importa.** Un backup que nunca se restauró es una promesa sin
verificar. Esta prueba confirma que el pipeline completo (cifrado → subida →
descarga → desencriptado → restore) funciona de punta a punta, no solo la
mitad subida.
