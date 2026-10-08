# Evaluación de preparación para v1

Fecha: 2026-10-06. Rama evaluada: `docs/sync-v1-oct2026` (basada en `main`, último PR mergeado #379).

Este documento resume qué tan lista está Umbral para una v1 con pacientes reales. Cada afirmación se contrastó con el código o con el estado de GitHub a la fecha indicada; lo que no se pudo verificar se marca como tal. No es una validación legal.

## Veredicto

**Listo con condiciones.**

El núcleo clínico, la seguridad de cuentas, los respaldos y el pipeline de CI están sólidos y verificables. No hay vulnerabilidades de producción conocidas. Las condiciones para salir son pocas y acotadas: resolver dos bloqueantes (infraestructura gratuita que apaga los procesos programados, y una nota de privacidad que afirma algo que el RAT contradice) y cerrar un conjunto de ajustes recomendados de bajo costo (health check, cierre por inactividad en móvil, restore reciente).

## Resumen ejecutivo

- Producto funcionalmente completo para el alcance de v1: pacientes, consultas versionadas, documentos, calendario con Google Calendar, agenda pública con checkout, cobro con Flow, recordatorios, notificaciones, MFA y auditoría.
- Los riesgos más serios no están en el código de negocio sino en la operación (Render plan gratuito) y en el cumplimiento (nota de privacidad, transferencia internacional sin revisión legal, datos clínicos sin cifrado a nivel de aplicación).
- Hay una distancia entre lo que el sistema hace y lo que conviene afirmar públicamente: el aislamiento entre terapeutas lo garantiza el código de aplicación (no políticas de base de datos) y las notas clínicas no se cifran a nivel de aplicación. Ver "Riesgos aceptables" para la redacción segura.

## Qué está sólido (con evidencia)

| Área | Evidencia (verificada el 2026-10-06) |
|---|---|
| Tamaño y estructura | 15 módulos en `backend/src/modules/`, 23 modelos en `backend/prisma/schema.prisma`, 65 migraciones en `backend/prisma/migrations/` (65 carpetas más `migration_lock.toml`), unos 83 handlers HTTP (conteo de decoradores `@Get/@Post/@Patch/@Put/@Delete`), 17 archivos de página en `frontend/src/pages/` |
| Pruebas | 86 specs unitarios en `backend/src`, 26 specs e2e en `backend/test`, 65 specs en `frontend/src`, 1 e2e de Playwright en `frontend/e2e/notification-detail.e2e.ts` |
| CI | `.github/workflows/ci.yml`: Postgres 16, lint, migraciones, seed, Jest con cobertura, e2e backend y `npm audit --omit=dev --audit-level=high` (`ci.yml:127` y `ci.yml:163`) |
| Dependencias | 0 vulnerabilidades de producción reportadas por la auditoría previa; evidencia de `npm audit` en `docs/evidencia-compliance/npm-audit/` |
| Respaldos | `.github/workflows/backup.yml`, cron `0 5 * * *` (diario 05:00 UTC), cifrado AES-256 y subida a Backblaze B2; las últimas 6 ejecuciones (2026-10-01 a 2026-10-06) terminaron en `success` según `gh run list`. Restore verificado el 2026-08-03 (ver `docs/incident-log.md`) |
| Cifrado en reposo (aplicación) | 4 claves AES-256-GCM separadas, validadas al arrancar en `backend/src/config/env.validation.ts`: documentos (`DOCUMENT_ENCRYPTION_KEY`), tokens de Google (`GOOGLE_TOKEN_ENCRYPTION_KEY`), credenciales de pago (`PAYMENT_CREDENTIALS_ENCRYPTION_KEY`) y secreto MFA (`MFA_SECRET_ENCRYPTION_KEY`). Primitivas en `backend/src/common/crypto/aes-gcm.ts` |
| Autenticación | Argon2 para contraseñas, MFA TOTP obligatorio con 10 códigos de recuperación (`MfaRecoveryCode`), sesiones revocables con `jti` (`Session`), throttling por ruta (`backend/src/config/throttler.config.ts`, 16 usos en `auth.controller.ts`) |
| Hardening HTTP | Helmet, `ValidationPipe` estricto y DTOs validados con class-validator |
| Webhooks | `POST /webhooks/resend` verifica firma Svix; el webhook de Flow no está firmado por el proveedor y la confianza se obtiene re-consultando el estado de la orden con las credenciales del terapeuta (`backend/src/modules/payments/payments.controller.ts`, comentario sobre `POST confirm`) |
| Auditoría | Bitácora `AuditLog` append-only con trigger en la base (`backend/prisma/migrations/20260715002944_audit_log_append_only_trigger/`) |
| Observabilidad de errores | Sentry opcional con depuración de PII en el backend (`backend/src/instrument.ts`: redacta emails y RUT, descarta bodies, cookies y headers, `tracesSampleRate: 0`) |
| RLS | `ENABLE ROW LEVEL SECURITY` en 27 sentencias de migración (por ejemplo `20260804170000_enable_rls_public_tables`). Ver el matiz en "Riesgos aceptables" |

## Bloqueantes antes de v1

### B1. Render plan gratuito: cold start y procesos programados dentro del proceso web

- `render.yaml:5` declara `plan: free`. El servicio duerme tras 15 minutos sin tráfico (README, sección Despliegue) y arranca en frío.
- Los 6 procesos programados corren dentro del mismo proceso web con `@nestjs/schedule` (`backend/src/app.module.ts:44`): recordatorios cada 5 minutos (`reminders.service.ts:104`), sincronización de calendario cada 15 minutos (`calendar-sync.service.ts:110`), bloques ocupados cada 30 minutos (`calendar-busy.service.ts:65`), reconciliación de pagos cada 30 minutos (`payment-reconciliation.service.ts:65`), purga de sesiones a las 04:00 (`session-purge.service.ts:41`) y purga de notificaciones a las 04:30 (`notifications-purge.service.ts:61`).
- Si el servicio duerme, esos procesos no corren: se pierden recordatorios de sesión (24 h y 2 h antes) y se retrasa la reconciliación de cobros. Issue #63 (abierto, etiqueta `pospuesto`).
- Clasificación: **Bloqueante** si v1 promete recordatorios o conciliación de pagos confiables. Salida: pasar a un plan siempre activo (Render Starter, #63) o, como mínimo, mover los crons a un disparador externo y dejar de prometer recordatorios puntuales.

### B2. Nota de privacidad de la agenda pública afirma que el terapeuta es el responsable del tratamiento

- `frontend/src/components/booking/PublicBookingForm.tsx:118` decía "Los recibe tu terapeuta, que es quien los trata" (frase eliminada, ver #376). El RAT (`docs/registro-actividades-tratamiento.md`, sección "Responsable del tratamiento") identifica como responsable a "Umbral - RCE". Issue #376 (la redacción final sigue pendiente de revisión legal).
- El texto se muestra a pacientes que entregan RUT y fecha de nacimiento, y la Ley 21.719 entra en vigencia en diciembre de 2026.
- Clasificación: **Bloqueante** (compliance). El arreglo de código es de una línea; lo que bloquea es que alguien con criterio legal defina la redacción.

## Recomendados antes de v1

| # | Tema | Evidencia | Justificación |
|---|---|---|---|
| R1 | ~~No hay health check que consulte la base~~ Resuelto (#380) | `backend/src/health/health.controller.ts` ejecuta `SELECT 1` con timeout de 5 s y responde 503 si falla; `render.yaml` apunta a `/api/v1/health` | Verificar tras el despliegue que Render marque el servicio como sano. Si la base cae, Render puede reiniciar la instancia |
| R2 | El cierre por inactividad no se dispara en móvil | Issue #367 (abierto, `bug`); temporizador en `frontend/src/hooks/useIdleTimeout.ts:58-72` | Es un control de seguridad (8 minutos) que no funciona donde más se usa. Mitigación parcial: JWT de 8 h y sesiones revocables. Recomendado alto: corregir antes de promover el uso desde celular |
| R3 | Restore de respaldo verificado solo en agosto | `docs/incident-log.md` (verificación del 2026-08-03, 11 tablas y 21 migraciones; hoy 65 migraciones y 23 modelos) | Repetir el restore contra el esquema actual es barato y valida que los respaldos siguen siendo útiles |
| R4 | Google OAuth en modo Testing | Issue #123 (abierto, `pospuesto`); README, sección Google Calendar | El refresh token caduca a los 7 días y la conexión se desconecta sola. Es opcional y el sistema degrada con aviso, pero genera soporte. Recomendado: iniciar la verificación de la app con Google |
| R5 | La cláusula de consentimiento ya aplicada ubica los "documentos asociados" en São Paulo | `docs/clausula-transferencia-internacional.md`; los documentos adjuntos viven en buckets de Backblaze (Estados Unidos) según el RAT | Revisión legal del texto de los `.docx`. Ver también la transferencia internacional abierta en el RAT |
| R6 | Transferencia internacional sin revisión legal | RAT, sección "Transferencia internacional de datos"; Sentry sin DPA recopilado | Es el pendiente más importante del RAT. No es de ingeniería |
| R7 | Cobertura mínima exigida baja y e2e fuera de CI | Umbrales 40/35 (statements/branches) en `backend/package.json:113-119` y 20/20 en `frontend/vitest.config.ts:18-23`; el único e2e de Playwright no corre en `ci.yml` | Hay 151 specs unitarios y 26 e2e de backend, pero los umbrales permiten degradar sin que CI falle. Subir umbrales de forma gradual |

## Riesgos aceptables o documentados

| # | Riesgo | Evidencia | Por qué es aceptable y cómo comunicarlo |
|---|---|---|---|
| A1 | Token y usuario en `localStorage` | `frontend/src/context/AuthContext.tsx:12-13` | Exposición ante XSS. Mitigado por sanitización con DOMPurify antes de inyectar HTML (`ConsultationsPage.tsx:179`), `sanitize-html` en el backend, cierre por inactividad y sesiones revocables. Aceptable para v1; migrar a cookie `HttpOnly` queda como mejora |
| A2 | RLS habilitada sin políticas | 27 `ENABLE ROW LEVEL SECURITY` y 0 `CREATE POLICY` en `backend/prisma/migrations/` | El aislamiento entre terapeutas lo hace el código de aplicación (`therapistId` en cada consulta), no la base. **No promocionar como "aislamiento a nivel de base de datos"**. La aplicación se conecta con un rol con `BYPASSRLS`, así que RLS solo bloquea el acceso directo por la API de datos de Supabase (ver `docs/decisiones/0004-cifrado-de-datos-clinicos-y-alcance-de-rls.md`). El efecto práctico de tener RLS sin políticas (denegar por defecto el acceso por la API de datos de Supabase) no se verificó en esta evaluación |
| A3 | Datos clínicos sin cifrado a nivel de aplicación | `backend/prisma/schema.prisma`: `Consultation.consultReason`, `intervention`, `agreements`, `patientRut`; `Patient.rut`; `PatientHistory.snapshot` son texto o JSON plano | Solo están cifrados los documentos subidos, los tokens de Google, las credenciales de pago y el secreto MFA. El cifrado en reposo del disco de Supabase no se verificó aquí. **No afirmar que las notas clínicas están cifradas**. Decisión: cifrarlas después de #382 (ver `docs/decisiones/0004-cifrado-de-datos-clinicos-y-alcance-de-rls.md`) |
| A4 | Claves de cifrado sin versionado ni rotación | `backend/src/common/crypto/aes-gcm.ts` (una clave por dominio, sin identificador de versión) | Perder `DOCUMENT_ENCRYPTION_KEY` deja los documentos ilegibles, y cambiarla exige reencriptar. Aceptable si las claves tienen copia segura fuera de Render. Checklist de salida: confirmar esa copia |
| A5 | "Multigateway" es una abstracción | `backend/src/modules/payments/payment-gateway.registry.ts`: hoy solo se registra `FLOW` | No afirmar soporte de varias pasarelas |
| A6 | Accesibilidad y responsive sin auditoría automatizada | No hay dependencias de axe ni similares en `frontend/package.json`; PR #355 hizo una revisión manual | Aceptable con seguimiento (#371). No afirmar cumplimiento de estándares de accesibilidad |
| A7 | Campos de pago deprecados | `backend/prisma/schema.prisma:749` (`merchantId`) y `:756` (`credentialVersion`) | Se conservan para cuentas del modelo anterior hasta que no quede ninguna fila v1; costo de mantenerlos es bajo |

## Deuda planificada

- Prisma 6 a 7 (#75, `prio: 6-deuda`, sin decisión) y el aviso de dependencias de desarrollo #255 (espera a #75).
- Majors congelados por el ADR 0001 (`docs/decisiones/0001-congelar-majors-nestjs-vite-tailwind.md`): NestJS 11 (el 12 queda fuera), Vite 7 (el 8 queda fuera) y Tailwind 3 (el 4 queda fuera) hasta después de la v1.
- Retiro de `merchantId` y `credentialVersion` (A7) cuando no queden cuentas v1.
- Seguimiento del calendario público (#371, 20 puntos menores).
- Funcionalidades pospuestas: recordatorios por WhatsApp (#161), boleta electrónica SII (#160), transcriptor de sesiones con IA (#162), múltiples tipos de servicio en la agenda (#156).

## Checklist de salida a v1

- [ ] B1: decidir y ejecutar la salida del plan gratuito de Render (o migrar los crons a un disparador externo) y, si no, quitar las promesas de recordatorios puntuales.
- [ ] B2: redactar con apoyo legal y publicar la nota de privacidad de la agenda pública (#376).
- [x] R1: endpoint de health con consulta a la base y `healthCheckPath` actualizado en `render.yaml`.
- [ ] R2: corregir el cierre por inactividad en móvil (#367) y probar en un dispositivo real.
- [ ] R3: repetir el restore de un respaldo reciente contra el esquema actual y anotarlo en `docs/incident-log.md`.
- [ ] R4: iniciar la verificación de la app OAuth de Google (#123) o dejar documentada la limitación.
- [ ] R5 y R6: revisión legal de la cláusula de transferencia internacional y del RAT (incluido Sentry).
- [ ] A4: confirmar copia segura, fuera de Render, de las 4 claves de cifrado y del secreto de cifrado de respaldos.
- [ ] Confirmar que el DSN de Sentry está cargado en Render y Vercel y que los eventos recibidos no contienen datos personales.
- [ ] Confirmar en producción las variables obligatorias (`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`) y que las migraciones recientes quedaron aplicadas.
- [ ] Revisar el texto público (landing, redes) contra `docs/datos-landing.md`: sin afirmaciones de certificación, aislamiento por RLS ni cifrado de notas clínicas.
