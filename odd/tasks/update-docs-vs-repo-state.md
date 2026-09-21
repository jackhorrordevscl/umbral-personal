# Actualizar documentación desactualizada vs. estado real del repo

## Objetivo
Sincronizar README.md y docs/manual-terapeutas.md con features ya implementadas en el código pero no documentadas.

## Por qué
Auditoría de lectura (fork) comparó los docs "vivos" del repo contra backend/src, frontend/src y schema.prisma. backend/README.md, frontend/README.md, docs/registro-actividades-tratamiento.md, docs/caso-de-uso-testing.md y docs/clausula-transferencia-internacional.md están al día. README.md y docs/manual-terapeutas.md tienen gaps reales.

## Alcance
Solo documentación (README.md, docs/manual-terapeutas.md). Sin cambios de código.

## Tareas

- [x] T1 — README.md: agregar sección de endpoints de `payments/` en "API Endpoints" (9 rutas reales, `payments.controller.ts:90-232`)
- [x] T2 — README.md: agregar `availability/`, `payments/`, `public-scheduling/` al árbol de "Estructura del Proyecto"
- [x] T3 — README.md: agregar `POST /auth/verify-email/resend` a la sección Autenticación — `auth.controller.ts:161`
- [x] T4 — README.md: agregar `GET /consultations/range` — `consultations.controller.ts:53`
- [x] T5 — README.md: agregar `POST /patients/consents/bulk-declare` — `patients.controller.ts:69`
- [x] T6 — README.md + manual-terapeutas.md: documentar feature de avatar de perfil — `profile.controller.ts:86-135`
- [x] T7 — README.md + manual-terapeutas.md: documentar notificación `PATIENT_MISSING_SESSION_AMOUNT` — `schema.prisma:446`

## Checks aplicables
Ninguno automatizado (solo prosa Markdown). Verificación: releer cada afirmación agregada contra el archivo de código citado antes de escribir.

## Ruta
Delegada — writer único para 2 archivos no triviales (README.md, docs/manual-terapeutas.md).
