# Registro de incidentes de seguridad

Bitácora de incidentes de seguridad reales detectados y resueltos durante el
desarrollo de Umbral. Existe como documento dedicado (issue #69) porque antes
estas narrativas vivían dispersas (dos como texto suelto en `README.md`, una
tercera solo como comentario de una línea en `.gitignore`), sin un lugar
único donde una revisión de compliance (CENS) pudiera encontrarlas.

Formato por incidente: qué pasó, impacto real, causa raíz, remediación,
verificación, y qué cambió para que no vuelva a pasar.

---

## 2026-08-02/03: Dumps de Postgres sin cifrar committeados en el historial de git

**Qué pasó.** El script `backup.sh` legacy (retirado en issue #61) escribía
sus dumps directo a `backups/files/`, una carpeta dentro del working tree del
repo. Desde marzo de 2026, 4 dumps `.sql.gz` **sin cifrar** (no
`.sql.gz.enc`) quedaron committeados ahí, porque el `.gitignore` de la época no
cubría esa ruta.

**Impacto.** El esquema de esos dumps incluía `User.passwordHash` y PII/PHI
de `Patient`/`Consultation`. Confirmado por el dueño del proyecto: eran datos
de prueba sin valor real (el proyecto recién arrancaba en esa fecha), por lo que no
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
- Si un script de backup local como `backup.sh` (retirado en el issue #61,
  cerrado) se reintroduce, tiene que escribir a una ruta gitignoreada desde
  el primer commit que lo reintroduzca.

---

## 2026-08-03: `AuditLog` no estaba protegido contra manipulación por el propio rol de runtime (issue #52)

**Qué pasó.** El procedimiento de reset manual de cuenta (último recurso
cuando se pierden contraseña y los 10 códigos de recuperación a la vez) deja
constancia en `AuditLog` como paso obligatorio del runbook. `AuditLog` tenía
un trigger `trg_audit_log_append_only` que bloqueaba `UPDATE`/`DELETE` sobre
filas ya escritas, pero **no** impedía que las mismas credenciales usadas
para ese procedimiento manual deshabilitaran el trigger
(`ALTER TABLE ... DISABLE TRIGGER` / `DROP TRIGGER`), hicieran el reset sin
dejar el paso de auditoría, y lo reactivaran después sin rastro. La causa:
el rol de runtime de la app era el **dueño** de la tabla, y el dueño de una
tabla en Postgres tiene esos permisos implícitos sin importar los
`GRANT`/`REVOKE` explícitos.

**Impacto.** Riesgo de manipulación silenciosa de la bitácora de auditoría
por cualquiera con las credenciales de runtime de la app, exactamente el
escenario que un log de auditoría append-only debería impedir. No hay
evidencia de que se haya explotado; se detectó en revisión de diseño, no en
un incidente activo.

**Primer intento descartado.** Un *event trigger* a nivel de base que
bloqueara ese DDL sin importar el rol. `CREATE EVENT TRIGGER` requiere
privilegios de superusuario en Postgres. Se verificó contra el rol real de
producción (`SELECT rolsuper FROM pg_roles WHERE rolname = current_user` →
`false`). No viable en Supabase, ni en staging ni en producción: es un techo
de la plataforma, no un problema de configuración.

**Remediación real.** Migración
`20260803060000_restrict_audit_log_owner_privileges`: se transfiere la
ownership de `"AuditLog"` a un rol nuevo sin login (`audit_log_owner`), y el
rol de runtime queda con `SELECT`/`INSERT` explícitos únicamente, sin
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
fallar con el rol de runtime actual porque ya no es el dueño: requiere un
paso manual documentado (otorgar membership de `audit_log_owner`
temporalmente, aplicar el cambio, revocarla de nuevo), no un
`prisma migrate deploy` automático sin intervención.

---

## 2026-08-03: Verificación real de restauración de backup offsite (issue #56)

**Qué se verificó.** Que el backup offsite cifrado (Backblaze B2, ver
[Configuración de Backups](../README.md#configuración-de-backups)) efectivamente
sirve para restaurar, no solo para subirse sin errores. No es un incidente en
el sentido de una falla real, pero se documenta acá como evidencia de
verificación de un control de continuidad, el tipo de evidencia que una
revisión CENS/ISMS pide.

**Procedimiento.** Se bajó el `.sql.gz.enc` real más reciente de B2, se
desencriptó y se restauró contra un Postgres local descartable (nunca contra
producción).

**Resultado.** Las 11 tablas de `schema.prisma` restauraron con datos
correctos, incluida `_prisma_migrations` con las 21 migraciones aplicadas. El
trigger `trg_audit_log_append_only` siguió bloqueando `UPDATE` después de
restaurar. El dump completo arrastra ~600 errores esperables de
roles/extensiones internas de Supabase (`supabase_admin`, `dashboard_user`,
`vault`, `pgbouncer`, etc.) que no existen fuera de su infraestructura, y no
son un problema: `psql -f` los saltea y sigue con el resto del archivo.

**Por qué importa.** Un backup que nunca se restauró es una promesa sin
verificar. Esta prueba confirma que el pipeline completo (cifrado → subida →
descarga → desencriptado → restore) funciona de punta a punta, no solo la
mitad subida.

**Nota (2026-10-06).** Las cifras de esta verificación (11 tablas y 21
migraciones) corresponden al esquema vigente el 2026-08-03. A la fecha de esta
nota `backend/prisma/migrations/` tiene 66 migraciones y `schema.prisma` define
23 modelos, por lo que esas cifras ya no describen el estado actual. La
verificación de restauración no se ha repetido desde entonces; conviene
repetirla contra el esquema actual antes de la salida a v1. La verificación se
repitió el 2026-10-14; ver la entrada de restauración al final de este registro.
A 2026-10-27 `backend/prisma/migrations/` tiene 77 migraciones y
`schema.prisma` define 27 modelos.

---

## 2026-10-14 — `TreatmentDischarge` creada sin Row Level Security (issue #461)

**Qué pasó.** La migración `20261011130000_add_treatment_discharge` creó la
tabla `"TreatmentDischarge"` (informe de alta, con texto clínico sin cifrar a
nivel de columna) sin `ENABLE ROW LEVEL SECURITY`. Era la única tabla de la
aplicación en esa situación. Una tabla del schema `public` sin RLS queda
accesible por la API REST que Supabase levanta sobre Postgres (PostgREST) con
la anon key, aunque la aplicación nunca la use. La migración estaba aplicada
en producción desde el 13 de octubre de 2026.

**Impacto.** Sin evidencia de acceso indebido. La tabla tenía 0 filas al
momento de la verificación (`SELECT count(*)` en producción el 2026-10-14), por
lo que no había contenido clínico que pudiera leerse a través de ella. El
código de la aplicación no usa el cliente de Supabase ni distribuye la anon
key (la aplicación accede a la base con Prisma), de modo que un tercero habría
necesitado obtener la clave y la URL del proyecto desde el panel de Supabase.
Los logs de la API de Supabase del último día no registran peticiones a
`/rest/v1/`. El plan gratuito retiene solo 24 horas de logs, por lo que los
accesos anteriores a esa ventana no pueden verificarse.

**Causa raíz.** La migración no incluyó la sentencia de RLS que sí usan las
demás tablas, y ningún control automático comparaba las tablas creadas con las
que tienen RLS activo. La omisión pasó la revisión y la integración continua.

**Remediación.**

- Mitigación inmediata en producción: `ALTER TABLE "TreatmentDischarge" ENABLE
  ROW LEVEL SECURITY;` ejecutada desde el SQL editor de Supabase, sin políticas
  (deny-all para `anon` y `authenticated`).
- Migración `20261014120000_enable_rls_treatment_discharge` (PR #462), con la
  misma sentencia. Es idempotente; al desplegarse sobre la mitigación manual no
  produce cambios. La aplicación no se ve afectada porque Prisma conecta con un
  rol que omite RLS.

**Verificación.** En producción, `pg_tables.rowsecurity` de
`"TreatmentDischarge"` devuelve `true`. Una consulta posterior del 2026-10-14
en Supabase confirma que las 28 tablas del schema `public` (los 27 modelos de
Prisma más `_prisma_migrations`) tienen RLS activo. En una base local, tras
aplicar todas las migraciones, los 27 modelos también lo tienen.

**Qué cambió.** Se agregó la prueba
`backend/src/common/utils/migrations-rls.spec.ts`, que recorre todas las
migraciones y falla si alguna tabla creada con `CREATE TABLE` no tiene su
`ENABLE ROW LEVEL SECURITY`. Una tabla nueva sin RLS rompe la integración
continua antes de llegar a producción.

**Nota (2026-10-27).** Verificado contra el repositorio: la migración
`20261014120000_enable_rls_treatment_discharge` y la prueba
`migrations-rls.spec.ts` siguen en `main`, y las migraciones siguen sin
`CREATE POLICY`. Los textos clínicos de `TreatmentDischarge` mencionados en
"Qué pasó" ("sin cifrar a nivel de columna") se guardan cifrados desde el
2026-10-17 (ADR 0004); el incidente es de RLS y su resolución no cambia.

---

## 2026-10-14: Verificación de restauración contra el esquema actual (R3 de la evaluación de v1)

**Qué se verificó.** Que un respaldo offsite reciente se descarga, se descifra
y se restaura contra el esquema vigente. Repite la verificación del
2026-08-03 (issue #56), cuyas cifras ya no describían el estado actual. No es un
incidente; se documenta como evidencia de un control de continuidad.

**Procedimiento.** Antes del clean total de la base de producción se generó un
respaldo manual con el workflow `backup.yml` (`workflow_dispatch`):
`umbral_backup_2026-10-14_23-46-14.sql.gz.enc` en B2. Se descifró con `openssl`
(primero) y se descomprimió con `gunzip`, y se restauró en una base descartable
(`umbral_restore_test`) del Postgres local en Docker. Nunca se restauró contra
producción.

**Resultado.** La restauración produjo las 28 tablas del schema `public` (los
27 modelos de Prisma más `_prisma_migrations`). El dump arrastra unos 734
errores esperables de roles y extensiones internas de Supabase, que no existen
fuera de su infraestructura; `psql -f` los saltea y continúa.

**Alcance y límites.**

- El respaldo se generó con el mismo workflow que el cron diario, pero se
  disparó a mano; no se restauró un archivo producido por la ejecución
  programada de las 05:00 UTC.
- Este registro no incluye la verificación de contenido fila por fila ni la del
  trigger `trg_audit_log_append_only` tras restaurar, que sí se hicieron en la
  prueba de agosto.
- Los datos cifrados de ese respaldo (documentos, tokens de Google,
  credenciales de pago y secreto MFA) solo se pueden leer con las claves
  anteriores al reemplazo del 14-15 de octubre; el responsable del proyecto las
  conserva. No se probó descifrar esos campos dentro de la base restaurada.
- El volcado en claro generado durante la prueba se borró (local y Docker); en
  `Docs Umbral` quedó solo el archivo `.enc`.
