# Issue #170 — Migrar avatares a Backblaze B2 (alcance: solo avatares)

## Objetivo
Render (plan free) no tiene disco persistente. Los avatares subidos vía
`ProfileService.uploadAvatar` se pierden en cada deploy, aunque
`User.avatarMimeType` sobreviva en DB (bug real ya parcheado a 404 en PR #169,
sin resolver la pérdida de datos). Migrar el storage de avatares de disco
local a Backblaze B2 (S3-compatible), sin cambiar el contrato de los
endpoints existentes.

## Alcance
- Solo avatares (`avatar-storage.util.ts`, `ProfileService`,
  `PublicTherapistProfileService`). **Shared-files queda fuera** (decisión
  explícita del usuario, issue de fondo más grande, no se toca acá).

## Decisiones ya tomadas
- Bucket B2 nuevo (privado, exclusivo para avatares): `umbral-avatars`,
  región `us-west-004`, endpoint `s3.us-west-004.backblazeb2.com`.
- Application Key nueva, Read+Write, restringida a ese bucket. Ya creada por
  el usuario (keyID / applicationKey no viajan por el chat).
- Nombres de env vars a usar (definir en `.env.example` y `render.yaml`,
  cargar los valores reales en el dashboard de Render, nunca en el repo):
  - `B2_AVATARS_ENDPOINT=https://s3.us-west-004.backblazeb2.com`
  - `B2_AVATARS_REGION=us-west-004`
  - `B2_AVATARS_BUCKET=umbral-avatars`
  - `B2_AVATARS_KEY_ID`
  - `B2_AVATARS_APPLICATION_KEY`
- Cliente: `@aws-sdk/client-s3` (S3-compatible, es lo que B2 documenta
  oficialmente para su API S3).
- Mantener la interfaz pública de `avatar-storage.util.ts`
  (`avatarPath`/`readAvatarBuffer`/etc. o equivalentes) para minimizar el
  diff en `profile.service.ts` y `public-therapist-profile.service.ts`.
- `ENOENT` (disco) pasa a ser `NoSuchKey`/404 de S3 — mantener el mismo
  manejo defensivo (404 "sin avatar", no 500) en ambos call sites.
- Avatares ya subidos hoy están perdidos igual (disco efímero) — no hace
  falta backfill, es un storage nuevo y vacío.

## Tareas
- [x] T1 — Agregar `@aws-sdk/client-s3` a `backend/package.json`.
- [x] T2 — Reescribir `backend/src/common/utils/avatar-storage.util.ts` para
      usar el cliente S3 (put/get/delete object) contra B2, leyendo config
      de las env vars de arriba. Mantener firma de funciones usada por los
      call sites.
- [x] T3 — Ajustar `profile.service.ts` (`uploadAvatar`/`getAvatar`/`deleteAvatar`)
      y `public-therapist-profile.service.ts` si cambia algo de la interfaz
      del util (manejo de "no existe" → 404).
- [x] T4 — Actualizar tests existentes (`profile.service.spec.ts`,
      `public-therapist-profile.service.spec.ts`, spec del util si existe)
      para mockear el cliente S3 en vez de `fs`.
- [x] T5 — Documentar env vars nuevas en `backend/.env.example` (si existe) y
      en `render.yaml` (solo nombres, sin valores) + nota breve en README
      sobre cómo cargarlas en Render.
- [x] T6 — Correr suite de tests del backend relacionada, confirmar verde.

## Evidencia

- `backend/.env.example` no existe en el repo (verificado con Glob) -- no
  aplica ese punto de T5. Se documentó igual en `render.yaml` (nombres de
  env vars, `sync: false`, mismo patrón que `DATABASE_URL`/`RESEND_API_KEY`)
  y una nota en `README.md` (checklist de setup de Render, junto al resto de
  env vars a cargar a mano).
- Comando corrido: `npx jest avatar-storage.util profile.service
  public-therapist-profile.service` (desde `backend/`).
  Resultado observado: `Test Suites: 3 passed, 3 total` /
  `Tests: 46 passed, 46 total`.
- Comando corrido: `npm test` (suite completa del backend).
  Resultado observado: `Test Suites: 3 failed, 59 passed, 62 total` /
  `Tests: 14 failed, 690 passed, 704 total`. Las 3 suites que fallan
  (`reminders.service.integration.spec.ts`,
  `calendar-sync.service.integration.spec.ts`,
  `consultations.service.integration.spec.ts`) son specs de integración
  preexistentes que requieren `DATABASE_URL` real (Postgres); fallan igual
  sin ninguno de los cambios de esta migración, por falta de esa env var en
  este entorno -- no están relacionadas con avatares/B2. Todas las specs
  unitarias, incluidas las 46 de avatares, pasan.
- Nota de diseño: se agregó `avatar-storage.util.spec.ts`, que no existía
  antes (T4 lo permite: "spec del util si existe" -- se creó porque ahora sí
  tiene lógica propia no trivial, la traducción de errores de B2 a 404, que
  antes vivía implícita en cada call site vía `ENOENT`).

## TDD
No se detectó modo TDD forzado explícito distinto al patrón existente del
repo — seguir el patrón ya usado en `profile.service.spec.ts` (tests
existentes, extender/adaptar sus mocks). Ejecutar la suite después de cada
cambio no trivial.

## Estado
Completo, pendiente de commit. Worktree: `issue-170-avatar-b2` (rama
`worktree-issue-170-avatar-b2`).
