# Evaluación de preparación para v1

Fecha: 2026-10-13 (revisión anterior: 2026-10-06). Rama evaluada: `docs/sync-docs-oct2026` (basada en `main` 8fb4089, último PR mergeado #460).

Este documento resume qué tan lista está Umbral para una v1 con pacientes reales. Cada afirmación se contrastó con el código o con el estado de GitHub a la fecha indicada; lo que no se pudo verificar se marca como tal. No es una validación legal.

## Veredicto

**Listo con condiciones.**

El núcleo clínico, la seguridad de cuentas, los respaldos y el pipeline de CI están sólidos y verificables. No hay vulnerabilidades de producción de nivel alto o crítico en el CI. Las condiciones para salir son pocas y acotadas: resolver un bloqueante abierto (infraestructura gratuita que apaga los procesos programados; el segundo bloqueante de la revisión anterior, la nota de privacidad, quedó cerrado con el issue #376) y cerrar los ajustes recomendados que siguen abiertos (restore reciente, verificación de la app OAuth de Google, revisión legal de la transferencia internacional). El health check (#380) y el cierre por inactividad en móvil (#367) ya se resolvieron.

## Resumen ejecutivo

- Producto funcionalmente completo para el alcance de v1: pacientes (incluidos menores con representante legal y asentimiento), consultas versionadas, documentos, informe de alta con registro de entregas, calendario con Google Calendar, agenda pública con checkout, cobro con Flow, recordatorios, notificaciones, MFA y auditoría.
- Los riesgos más serios no están en el código de negocio sino en la operación (Render plan gratuito) y en el cumplimiento (transferencia internacional sin revisión legal completa, datos clínicos sin cifrado a nivel de aplicación).
- Hay una distancia entre lo que el sistema hace y lo que conviene afirmar públicamente: el aislamiento entre terapeutas lo garantiza el código de aplicación (no políticas de base de datos) y las notas clínicas no se cifran a nivel de aplicación. Ver "Riesgos aceptables" para la redacción segura.

## Qué está sólido (con evidencia)

| Área | Evidencia (verificada el 2026-10-13) |
|---|---|
| Tamaño y estructura | 16 módulos en `backend/src/modules/` (más `health` y `shared-files` en `backend/src/`), 27 modelos en `backend/prisma/schema.prisma`, 73 migraciones en `backend/prisma/migrations/` (73 carpetas más `migration_lock.toml`), unos 104 handlers HTTP (conteo de decoradores `@Get/@Post/@Patch/@Put/@Delete`), 17 archivos de página en `frontend/src/pages/` |
| Pruebas | 114 specs unitarios en `backend/src`, 31 specs e2e en `backend/test`, 84 specs en `frontend/src`, 3 e2e de Playwright en `frontend/e2e/` (`notification-detail`, `public-booking` y `public-booking.mobile`) |
| CI | `.github/workflows/ci.yml`: Postgres 16, lint, migraciones, seed, Jest con cobertura, e2e backend, `npm audit --omit=dev --audit-level=high` (`ci.yml:133` y `ci.yml:169`) y un job `e2e` con Playwright contra un backend real. El CI de `main` pasó el 2026-10-13 |
| Dependencias | Sin hallazgos high o critical en producción en el CI; evidencia de `npm audit` en `docs/evidencia-compliance/npm-audit/` |
| Respaldos | `.github/workflows/backup.yml`, cron `0 5 * * *` (diario 05:00 UTC), cifrado AES-256 y subida a Backblaze B2; las últimas 8 ejecuciones (2026-10-07 a 2026-10-13) terminaron en `success` según `gh run list`. Restore verificado el 2026-08-03 (ver `docs/incident-log.md`) |
| Cifrado en reposo (aplicación) | 4 claves AES-256-GCM separadas, validadas al arrancar en `backend/src/config/env.validation.ts`: documentos (`DOCUMENT_ENCRYPTION_KEY`), tokens de Google (`GOOGLE_TOKEN_ENCRYPTION_KEY`), credenciales de pago (`PAYMENT_CREDENTIALS_ENCRYPTION_KEY`) y secreto MFA (`MFA_SECRET_ENCRYPTION_KEY`). Llavero versionado y formato con AAD en `backend/src/common/crypto/` (`keyring.ts`, `aes-gcm.ts`), re-cifrado con `backend/scripts/reencrypt-keys.ts` (ADR 0005, `docs/rotacion-y-respaldo-de-claves.md`) |
| Autenticación | Argon2 para contraseñas, MFA TOTP obligatorio con 10 códigos de recuperación (`MfaRecoveryCode`) y anti-reutilización de código (`User.lastUsedStep`), sesiones revocables con `jti` (`Session`), throttling por ruta (`backend/src/config/throttler.config.ts`, decoradores de throttling en `auth.controller.ts`) |
| Hardening HTTP | Helmet, `ValidationPipe` estricto y DTOs validados con class-validator |
| Webhooks | `POST /webhooks/resend` verifica firma Svix; el webhook de Flow no está firmado por el proveedor y la confianza se obtiene re-consultando el estado de la orden con las credenciales del terapeuta (`backend/src/modules/payments/payments.controller.ts`, comentario sobre `POST confirm`) |
| Auditoría | Bitácora `AuditLog` append-only con trigger en la base (`backend/prisma/migrations/20260715002944_audit_log_append_only_trigger/`) |
| Observabilidad de errores | Sentry opcional con depuración de PII en el backend (`backend/src/instrument.ts`: redacta emails y RUT, descarta bodies, cookies y headers, `tracesSampleRate: 0`) |
| RLS | `ENABLE ROW LEVEL SECURITY` en 27 sentencias de migración (por ejemplo `20260804170000_enable_rls_public_tables`); la tabla `TreatmentDischarge` es la excepción (A8). Ver el matiz en "Riesgos aceptables" |

## Bloqueantes antes de v1

### B1. Render plan gratuito: cold start y procesos programados dentro del proceso web

- `render.yaml:5` declara `plan: free`. El servicio duerme tras 15 minutos sin tráfico (README, sección Despliegue) y arranca en frío.
- Los 6 procesos programados corren dentro del mismo proceso web con `@nestjs/schedule` (`backend/src/app.module.ts:46`): recordatorios cada 5 minutos (`reminders.service.ts:104`), sincronización de calendario cada 15 minutos (`calendar-sync.service.ts:110`), bloques ocupados cada 30 minutos (`calendar-busy.service.ts:65`), reconciliación de pagos cada 30 minutos (`payment-reconciliation.service.ts:66`), purga de sesiones a las 04:00 (`session-purge.service.ts:41`) y purga de notificaciones a las 04:30 (`notifications-purge.service.ts:61`).
- Si el servicio duerme, esos procesos no corren: se pierden recordatorios de sesión (24 h y 2 h antes) y se retrasa la reconciliación de cobros. Issue #63 (abierto, etiqueta `pospuesto`).
- Mitigación vigente (issue #422): un monitor externo hace ping a `/api/v1/health` cada 10 minutos para que el servicio no duerma (detalle y límite de horas gratis en el README, sección Despliegue). Reduce el problema, no lo elimina: un deploy o reinicio deja el servicio frío un momento.
- Clasificación: **Bloqueante** si v1 promete recordatorios o conciliación de pagos confiables. Salida: pasar a un plan siempre activo (Render Starter, #63) o, como mínimo, mover los crons a un disparador externo y dejar de prometer recordatorios puntuales.

### B2. Nota de privacidad de la agenda pública afirma que el terapeuta es el responsable del tratamiento (cerrado)

- Estado al 2026-10-13: el issue #376 está cerrado. La frase "Los recibe tu terapeuta, que es quien los trata" ya no está; la nota actual (`frontend/src/components/booking/PublicBookingForm.tsx`, `data-testid="booking-privacy-note"`) dice "Los recibe tu terapeuta" y enlaza la política de privacidad (`PRIVACY_POLICY_URL`).
- El RAT (`docs/registro-actividades-tratamiento.md`, sección "Responsable del tratamiento") define los roles según el tipo de dato. El responsable del proyecto informó que el abogado los revisó el 2026-10-08; no hay un documento de esa revisión en el repositorio.
- El texto se muestra a pacientes que entregan RUT y fecha de nacimiento, y la Ley 21.719 entra en vigencia en diciembre de 2026.
- Clasificación anterior: **Bloqueante** (compliance). Ya no lo es; queda como seguimiento verificar que la política pública (repo `umbral-landing`) coincida con el RAT.

## Recomendados antes de v1

| # | Tema | Evidencia | Justificación |
|---|---|---|---|
| R1 | ~~No hay health check que consulte la base~~ Resuelto (#380) | `backend/src/health/health.controller.ts` ejecuta `SELECT 1` con timeout de 5 s y responde 503 si falla; `render.yaml` apunta a `/api/v1/health` | Verificar tras el despliegue que Render marque el servicio como sano. Si la base cae, Render puede reiniciar la instancia |
| R2 | ~~El cierre por inactividad no se dispara en móvil~~ Resuelto (#367) | Issue #367 cerrado (PR #409); `frontend/src/hooks/useIdleTimeout.ts` compara la última actividad por reloj de pared al volver a primer plano (`visibilitychange`) | Control de seguridad de 8 minutos. Según el responsable del proyecto, se probó en un celular real |
| R3 | Restore de respaldo verificado solo en agosto | `docs/incident-log.md` (verificación del 2026-08-03, 11 tablas y 21 migraciones; hoy 73 migraciones y 27 modelos; el restore no se ha repetido) | Repetir el restore contra el esquema actual es barato y valida que los respaldos siguen siendo útiles |
| R4 | Google OAuth en modo Testing | Issue #123 (abierto, `pospuesto`); README, sección Google Calendar | El refresh token caduca a los 7 días y la conexión se desconecta sola. Es opcional y el sistema degrada con aviso, pero genera soporte. Recomendado: iniciar la verificación de la app con Google |
| R5 | La cláusula de consentimiento ya aplicada ubica los "documentos asociados" en São Paulo | `docs/clausula-transferencia-internacional.md`; los documentos adjuntos viven en buckets de Backblaze (Estados Unidos) según el RAT | Revisión legal del texto de los `.docx`. Ver también la transferencia internacional abierta en el RAT |
| R6 | Transferencia internacional sin revisión legal | RAT, sección "Transferencia internacional de datos". DPA de Sentry y de Render recopilados el 2026-10-08 (`docs/evidencia-compliance/`); sin evidencia de Cloudflare, Vercel ni Google Fonts, que forman parte de la ruta del tráfico | Es el pendiente más importante del RAT. No es de ingeniería |
| R7 | ~~Cobertura mínima exigida baja y e2e fuera de CI~~ Mejorado (#383) | Umbrales 80/70/75/80 (statements/branches/functions/lines) en `backend/package.json:115-121` y 70/65/65/70 en `frontend/vitest.config.ts:18-23`; los e2e de Playwright corren en el job `e2e` de `ci.yml` | Hay 198 specs unitarios (114 de backend y 84 de frontend) y 31 e2e de backend. Seguimiento en #419 (pago simulado y revisión móvil automatizada) |

## Riesgos aceptables o documentados

| # | Riesgo | Evidencia | Por qué es aceptable y cómo comunicarlo |
|---|---|---|---|
| A1 | Token y usuario en `localStorage` | `frontend/src/context/AuthContext.tsx` (claves `token` y `user`), ADR 0003 | Exposición ante XSS. Mitigado por la Content-Security-Policy de `frontend/vercel.json` (#386), sanitización con DOMPurify antes de inyectar HTML (`ConsultationsPage.tsx:221`), `sanitize-html` en el backend, cierre por inactividad y sesiones revocables. Aceptable para v1; migrar a cookie `HttpOnly` queda como mejora (#387) |
| A2 | RLS habilitada sin políticas | 27 `ENABLE ROW LEVEL SECURITY` y 0 `CREATE POLICY` en `backend/prisma/migrations/` | El aislamiento entre terapeutas lo hace el código de aplicación (`therapistId` en cada consulta), no la base. **No promocionar como "aislamiento a nivel de base de datos"**. La aplicación se conecta con un rol con `BYPASSRLS`, así que RLS solo bloquea el acceso directo por la API de datos de Supabase (ver `docs/decisiones/0004-cifrado-de-datos-clinicos-y-alcance-de-rls.md`). El efecto práctico de tener RLS sin políticas (denegar por defecto el acceso por la API de datos de Supabase) no se verificó en esta evaluación |
| A3 | Datos clínicos sin cifrado a nivel de aplicación | `backend/prisma/schema.prisma`: `Consultation.consultReason`, `intervention`, `agreements`, `patientRut`; `Patient.rut`; `PatientHistory.snapshot`; los textos de `TreatmentDischarge` (`consultReason`, `diagnosis`, `evolutionSummary`, `statusAtDischarge`, `recommendations`) son texto o JSON plano | Solo están cifrados los documentos subidos, los tokens de Google, las credenciales de pago y el secreto MFA. El cifrado en reposo del disco de Supabase no se verificó aquí. **No afirmar que las notas clínicas están cifradas**. Decisión: cifrarlas después de #382 (ver `docs/decisiones/0004-cifrado-de-datos-clinicos-y-alcance-de-rls.md`) |
| A4 | Claves de cifrado: respaldo y rotación | Llavero versionado y formato con AAD en `backend/src/common/crypto/keyring.ts` (ADR 0005); script `backend/scripts/reencrypt-keys.ts`; procedimiento en `docs/rotacion-y-respaldo-de-claves.md`. Issues #382 y #398 abiertos | El versionado y el re-cifrado ya existen, pero la clave id 0 sigue siendo obligatoria al arrancar. Perder `DOCUMENT_ENCRYPTION_KEY` deja los documentos ilegibles. Aceptable si las claves tienen copia segura fuera de Render. Checklist de salida: confirmar esa copia |
| A5 | "Multigateway" es una abstracción | `backend/src/modules/payments/payment-gateway.registry.ts`: hoy solo se registra `FLOW` | No afirmar soporte de varias pasarelas |
| A6 | Accesibilidad y responsive con auditoría automatizada parcial | `@axe-core/playwright` en `frontend/package.json` y `frontend/e2e/helpers/axe.ts`, usado en los e2e de la reserva pública; PR #355 hizo una revisión manual; seguimiento #371 (cerrado) | La cobertura automática alcanza solo las pantallas de los e2e. No afirmar cumplimiento de estándares de accesibilidad |
| A7 | Campos de pago deprecados | `backend/prisma/schema.prisma:1028` (`merchantId`) y `:1035` (`credentialVersion`) | Se conservan para cuentas del modelo anterior hasta que no quede ninguna fila v1; costo de mantenerlos es bajo |
| A8 | La tabla `TreatmentDischarge` no tiene RLS habilitada | `backend/prisma/migrations/20261011130000_add_treatment_discharge/migration.sql` crea la tabla sin `ENABLE ROW LEVEL SECURITY`; las demás tablas de la aplicación sí la tienen (ADR 0004) | Es un hallazgo de esta revisión, no una decisión documentada. La tabla guarda los textos clínicos del informe de alta sin cifrar. No se verificó en esta evaluación qué acceso tendría la API de datos de Supabase a esa tabla. Corregirlo requiere una migración nueva |

## Deuda planificada

- Prisma 6 a 7 (#75, `prio: 6-deuda`, sin decisión) y el aviso de dependencias de desarrollo #255 (espera a #75).
- Majors congelados por el ADR 0001 (`docs/decisiones/0001-congelar-majors-nestjs-vite-tailwind.md`): NestJS 11 (el 12 queda fuera), Vite 7 (el 8 queda fuera) y Tailwind 3 (el 4 queda fuera) hasta después de la v1.
- Retiro de `merchantId` y `credentialVersion` (A7) cuando no queden cuentas v1.
- Migrar el frontend a Tailwind 4 para resolver 7 vulnerabilidades de desarrollo (#458, abierto; reabriría el ADR 0001) y migrar la sesión a cookie `HttpOnly` (#387).
- Seguimiento de las pruebas e2e de reserva pública y pago (#419) y retiro de la clave id 0 del entorno (#398).
- Funcionalidades pospuestas: recordatorios por WhatsApp (#161), boleta electrónica SII (#160), transcriptor de sesiones con IA (#162), múltiples tipos de servicio en la agenda (#156).

## Checklist de salida a v1

- [ ] B1: decidir y ejecutar la salida del plan gratuito de Render (o migrar los crons a un disparador externo) y, si no, quitar las promesas de recordatorios puntuales.
- [x] B2: nota de privacidad de la agenda pública y roles del RAT (#376, cerrado). Pendiente verificar que la política pública coincida con el RAT.
- [x] R1: endpoint de health con consulta a la base y `healthCheckPath` actualizado en `render.yaml`.
- [x] R2: cierre por inactividad en móvil corregido (#367, PR #409) y probado en un dispositivo real, según el responsable del proyecto.
- [ ] R3: repetir el restore de un respaldo reciente contra el esquema actual y anotarlo en `docs/incident-log.md`.
- [ ] R4: iniciar la verificación de la app OAuth de Google (#123) o dejar documentada la limitación.
- [ ] R5 y R6: revisión legal de la cláusula de transferencia internacional y del RAT (incluidos Sentry, Cloudflare, Vercel y Google Fonts).
- [ ] A8: decidir si se habilita RLS en `TreatmentDischarge` con una migración nueva.
- [ ] A4: confirmar copia segura, fuera de Render, de las 4 claves de cifrado y del secreto de cifrado de respaldos.
- [ ] Confirmar que el DSN de Sentry está cargado en Render y Vercel y que los eventos recibidos no contienen datos personales.
- [ ] Confirmar en producción las variables obligatorias (`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`) y que las migraciones recientes quedaron aplicadas.
- [ ] Revisar el texto público (landing, redes) contra `docs/datos-landing.md`: sin afirmaciones de certificación, aislamiento por RLS ni cifrado de notas clínicas.
