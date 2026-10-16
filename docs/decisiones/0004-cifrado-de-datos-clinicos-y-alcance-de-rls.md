# ADR 0004 - Cifrado de datos clínicos y alcance de RLS

- **Estado:** aceptada
- **Fecha:** 2026-10-07
- **Issue:** #381
- **Nota de estado (2026-10-13):** el paso 2 (cifrar las notas clínicas) sigue sin implementarse; el versionado de claves que lo condicionaba ya existe (ADR 0005). La tabla del informe de alta, agregada después (`TreatmentDischarge`), también guarda sus textos sin cifrar. La migración que crea `TreatmentDischarge` (`20261011130000_add_treatment_discharge`) no incluyó `ENABLE ROW LEVEL SECURITY`; se corrigió el 2026-10-14 con `20261014120000_enable_rls_treatment_discharge` (issue #461), de modo que hoy las 28 tablas tienen RLS (27 sentencias directas y la de `AuditLog`, dentro de un bloque `DO`).
- **Nota de estado (2026-10-16):** el ADR 0005 pasó a "aceptada" con el llavero, el formato `0x02`/`enc:v3` y el issue #398 implementados, y #382 está cerrado, por lo que la condición del paso 2 se cumple. A esta fecha no existe un issue de implementación del paso 2 (la sección Consecuencias prevé abrirlo) y los servicios de consultas y de informes de alta no cifran sus textos. Las afirmaciones de la sección Contexto sobre el secreto MFA con prefijo `enc:v1:` y la ausencia de rotación describen el 2026-10-07; el formato vigente está en el ADR 0005.

## Contexto

Hoy solo se cifran a nivel de aplicación los documentos subidos, los tokens de
Google, las credenciales de pago y el secreto MFA (AES-256-GCM, una clave por
dominio; ver `backend/src/common/crypto/aes-gcm.ts`). Los datos clínicos se
guardan en texto plano en la base:

- `Consultation.consultReason`, `intervention`, `agreements` y `patientRut`.
- `PatientHistory.snapshot` y `diff`, y `ConsultationHistory.snapshot` (copias
  completas de la ficha en JSON).
- `Patient.fullName`, `rut` y datos de contacto.

Sobre RLS: las migraciones habilitan `ROW LEVEL SECURITY` en las 28 tablas (27
sentencias `ENABLE ROW LEVEL SECURITY` directas y la de `AuditLog`, dentro de un
bloque `DO`) y no tienen ninguna `CREATE POLICY`. La aplicación se conecta con
el rol `postgres` de Supabase, que tiene `BYPASSRLS`, por lo que RLS no
participa en ninguna consulta de la aplicación. Su único efecto es denegar el
acceso directo por la API de datos de Supabase (PostgREST con la clave
anónima). El aislamiento entre terapeutas lo hacen los filtros `therapistId`
en los servicios (`patients.service.ts`, `consultations.service.ts`).

Verificado en producción el 2026-10-14 con consultas de solo lectura en
Supabase: `postgres` tiene `rolsuper = false` y `rolbypassrls = true`;
`audit_log_owner` no tiene `BYPASSRLS`; las 28 tablas de `public` tienen RLS
activo. La consulta de conexiones abiertas (`pg_stat_activity`) solo muestra los
usuarios `postgres`, `supabase_admin`, `authenticator` y `pgbouncer`, sin
ningún rol propio de la aplicación. Además, el usuario de la `DATABASE_URL`
configurada en Render tiene la forma `postgres.<ref>` (revisado el 2026-10-14
en el panel de Render); el pooler de Supabase lo traduce al rol `postgres`.
No se ejecutó `SELECT current_user` con esa cadena.

Sobre la propiedad de las tablas: las tablas normales pertenecen al rol con
que corren las migraciones, el mismo que usa la aplicación, y `AuditLog`
pertenece a `audit_log_owner` (sin login), con solo `SELECT` e `INSERT` para
la aplicación. Lo que hace que la aplicación omita RLS es `BYPASSRLS`, no ser
dueña de la tabla. Por eso el comentario de la migración
`20261014120000_enable_rls_treatment_discharge`, que dice que el backend
accede "con el rol dueño de la tabla", es válido para las tablas normales pero
no para `AuditLog`.

Restricciones técnicas relevantes para cifrar:

- La búsqueda de pacientes usa `contains` sobre `fullName` y `rut`
  (`patients.service.ts`), y el RUT tiene un índice único parcial por terapeuta
  (`Patient_therapistId_rut_active_key`). Cifrar esos campos rompe ambas cosas
  y exigiría columnas con hash ciego (HMAC).
- Los campos de texto clínico de `Consultation` no se buscan ni se indexan.
- Los cifrados actuales no llevan identificador de versión de clave (solo el
  secreto MFA usa el prefijo `enc:v1:`) y no hay rotación (ver #382).

## Alternativas evaluadas

| Alternativa | Qué resuelve | Costo |
| --- | --- | --- |
| **A. Solo documentar que no se cifra** | Alinea la comunicación pública con la realidad | Mínimo, pero deja las notas clínicas legibles ante una filtración de la base o de un volcado |
| **B. Cifrar solo las notas clínicas** | Protege el contenido más sensible sin romper búsqueda ni unicidad | Medio: migración de datos existentes y clave versionada |
| **C. Cifrar también identificadores (nombre, RUT)** | Cobertura total de los datos personales | Alto: hash ciego para búsqueda y unicidad, reescritura de consultas y de la migración del índice |

## Decisión

Se adopta la alternativa **B**, con esta secuencia:

1. **Ahora (este ADR):** documentar el estado real. Las notas clínicas no están
   cifradas a nivel de aplicación y RLS no aísla a los terapeutas. La
   comunicación pública sigue sin afirmar ninguna de las dos cosas.
2. **Después de #382** (versionado y rotación de claves): cifrar
   `Consultation.consultReason`, `intervention` y `agreements`, y los
   snapshots de `PatientHistory` y `ConsultationHistory`, con una clave nueva
   y un prefijo de versión desde el primer día.
3. **Fuera de alcance:** `fullName`, `rut`, `patientRut` y datos de contacto
   permanecen en texto plano. Cifrarlos (alternativa C) se reevalúa solo si
   aparece un requisito legal o contractual concreto.
4. **RLS:** no se escriben políticas. Se mantiene como defensa contra el
   acceso directo por PostgREST y se documenta como tal.

## Por qué

- Las notas clínicas son el contenido más sensible y el que menos usa la
  aplicación en consultas, así que cifrarlas tiene el mejor costo-beneficio.
- Hacerlo antes de #382 obligaría a migrar de nuevo al introducir versionado.
- Escribir políticas RLS no aportaría aislamiento mientras la aplicación use un
  rol con `BYPASSRLS`. Cambiar de rol y fijar `app.therapist_id` por petición
  es un rediseño que no se justifica para v1.

## Consecuencias

- Hasta que se implemente el paso 2, una filtración de la base expone las notas
  clínicas en claro. Los respaldos sí salen cifrados (`backup.yml`, AES-256),
  pero el volcado contiene el texto plano antes de cifrarse.
- El cifrado en reposo del disco de Supabase no está verificado.
- Material público: no afirmar cifrado de notas clínicas ni aislamiento por RLS
  o "a nivel de base de datos" (ver `docs/datos-landing.md`).
- Se abrirá un issue de implementación del paso 2 cuando #382 esté cerrado.
