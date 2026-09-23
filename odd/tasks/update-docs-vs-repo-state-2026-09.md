# Actualizar documentación vs. estado real del repo (ronda septiembre 2026)

## Objetivo
Sincronizar toda la documentación viva del repo con las features mergeadas a `main` desde el último sync de docs (commit `c4755c2`).

## Por qué
Desde `c4755c2` (docs: sincronizar README y manual-terapeutas) se mergearon 8 features/fixes sin reflejar en README.md / docs/manual-terapeutas.md / backend/README.md / frontend/README.md:
- #165 — tracking de origen de pacientes en autoagenda pública (7105fe1)
- #166 — tracking de entrega/apertura de emails de recordatorio (9542a4b)
- #167 — perfil público del terapeuta: foto, bio, especialidad (e644f64)
- #168 — CORP cross-origin en avatar público (70c93ab)
- #169 — 404 en vez de 500 si el avatar no existe (80357f2)
- #171 — migración de avatares de perfil a Backblaze B2 (96f359e)
- #172 — foto de perfil más grande y cuadrada en agenda pública (d3af6a3)
- #173 — migración de shared-files a Backblaze B2 (f348168)

También corresponde revisar que el estado de issue #123 (Google OAuth atascado en "Testing") esté documentado en `docs/incident-log.md` o donde corresponda, ya que el usuario confirmó que sigue pendiente de verificación de Google.

## Alcance
Solo documentación: README.md, docs/manual-terapeutas.md, backend/README.md, frontend/README.md, docs/incident-log.md. Sin cambios de código. Registro neutral (sin voseo), aunque la conversación con el usuario use voseo.

## Tareas

- [x] T1 — Auditoría: comparar cada doc listado contra el código real de las 8 features/fixes de arriba y contra `docs/incident-log.md` para #123. Listar gaps concretos con archivo:línea de evidencia.
- [x] T2 — Aplicar los fixes de documentación encontrados en T1, citando el archivo de código real en cada afirmación agregada.
- [x] T3 — Verificación: releer cada afirmación agregada contra el archivo de código citado antes de dar por cerrada la tarea.

### Resumen por archivo

- **README.md**: agregada limitación conocida de Google OAuth en "Testing"
  (issue #123, sección Google Calendar); bio/especialidad y storage B2 del
  avatar en la sección Perfil; perfil público (foto/especialidad/bio) y
  tracking de origen de pacientes en la sección Auto-agenda pública;
  tracking de entrega/apertura de recordatorios por email (webhook Resend)
  en la sección Recordatorios; nuevos endpoints en API Endpoints
  (`GET /patients/stats/acquisition`, `GET
  /public/therapists/:therapistId/profile` y `.../avatar`); filas nuevas en
  Variables de Entorno para `RESEND_WEBHOOK_SECRET`, `B2_AVATARS_*` y
  `B2_SHARED_FILES_*`; nota en el `.env` de ejemplo local sobre que avatar y
  shared-files requieren esas credenciales B2 también en desarrollo. (Las
  filas de `B2_AVATARS_*` en la sección Despliegue ya existían de los PR
  #171/#173; no se tocaron.)
- **docs/manual-terapeutas.md**: sección 10 (Ajustes) con la nueva
  "Perfil público" (especialidad + bio); sección 13 (Auto-agenda pública)
  con qué ve el paciente del perfil público y el nuevo bloque "Origen de
  pacientes" en el Dashboard; sección 11 (Notificaciones y recordatorios)
  con el chip de estado de entrega/apertura de email en Consultas.
- **backend/README.md**: sin cambios — ya delega toda especificación
  (endpoints, env vars) al README raíz, sin contenido propio desactualizado.
- **frontend/README.md**: sin cambios — mismo caso que backend/README.md.
- **docs/incident-log.md**: sin cambios. No menciona el issue #123 (no es
  un incidente de seguridad resuelto, sino una limitación externa abierta
  pendiente de verificación de Google), así que no había nada que corregir
  ahí; la limitación se documentó en su lugar en README.md, sección Google
  Calendar, dejando explícito que sigue sin resolver.

## Checks aplicables
Ninguno automatizado (solo prosa Markdown). Verificación manual línea por línea contra el código citado.

## Ruta
Delegada — un único worker hace auditoría + escritura (preparación de lectura + escritura combinadas), ya que toca potencialmente 5 archivos no triviales.

## Estado
Completo.
