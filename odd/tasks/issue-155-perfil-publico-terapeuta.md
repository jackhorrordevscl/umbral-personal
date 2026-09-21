# Issue #155 — Perfil público con foto, bio y especialidad en autoagenda

## Objetivo
Mostrar en `PublicBookingPage.tsx` (antes del calendario) foto de perfil, bio corta y especialidad del terapeuta, para mejorar conversión del visitante.

## Problema / por qué
Hoy `/book/:therapistId` va directo al calendario sin ningún dato del terapeuta. Comparación con encuadrado.com, que sí muestra perfil público.

## Decisión de alcance (corrige la premisa original del issue)
El issue pedía "reutilizar Backblaze ya integrado para archivos compartidos" — **falso**: no existe integración de Backblaze en código, solo backups DB vía rclone. Storage real actual es disco local (Multer) para avatar y shared-files.
Decisión con el usuario (2026-09-21): usar el mismo patrón de disco local que el avatar existente, NO migrar a Backblaze. Justificación: filesystem ya persiste en Render, patrón ya probado, Backblaze sumaría complejidad no justificada para una foto de perfil pública sin PHI.

## Alcance
- Backend: campos `bio` (String?) y `specialty` (String?) en `model User`, migración Prisma.
- Backend: endpoint público `GET /public/therapists/:therapistId/profile` (nombre, bio, specialty, indicador de si tiene avatar) — sin JWT.
- Backend: endpoint público `GET /public/therapists/:therapistId/avatar` (sirve el binario, sin JWT) — reusa `AVATAR_DIR` existente.
- Backend: permitir editar `bio`/`specialty` desde `ProfilePage` (reusar `profile.controller.ts`/`profile.service.ts`, autenticado).
- Frontend: función API pública para el perfil + variante de avatar público (sin fetch autenticado con blob).
- Frontend: sección de perfil en `PublicBookingPage.tsx` antes del calendario (foto, bio, badge de especialidad).
- Frontend: en `ProfilePage.tsx`, inputs para editar bio/specialty.

Fuera de alcance: migración a Backblaze, rating/reviews (no pedido en el issue).

## Constraints
- No exponer PHI ni datos sensibles en el endpoint público.
- Mantener el patrón de foto de perfil actual (mismo `AVATAR_DIR`, mismo `avatarMimeType`).
- Bio corta (limitar longitud, ej. 500 chars) para evitar abuso.

## TDD
Sin configuración de TDD obligatoria detectada en el proyecto (no hay mandato explícito). Se ejecutan checks funcionales: `npm run build` / lint / tests existentes tras cada tarea, sin exigir RED-GREEN-REFACTOR estricto.

## Tareas

- [x] T1 (backend/schema): agregado `bio String?` y `specialty String?` a `model User`. Migración manual `20260921160000_add_therapist_bio_specialty` (shadow DB de `prisma migrate dev` falla por las policies RLS, mismo patrón ya usado en migraciones previas del repo). Aplicada a la DB local y client regenerado. Ruta: inline.
- [x] T2 (backend/endpoint público perfil): `GET /public/therapists/:therapistId/profile` en módulo nuevo `public-therapist-profile` (controller+service+specs), sin JWT, con `PublicScheduleThrottlerGuard`. Devuelve `{ name, bio, specialty, hasAvatar }`, 404 si no existe/no es PROFESSIONAL. Ruta: delegado (writer).
- [x] T3 (backend/endpoint público avatar): `GET /public/therapists/:therapistId/avatar`, mismo guard/throttle, sirve el binario vía `readAvatarBuffer()` extraído a `backend/src/common/utils/avatar-storage.util.ts` (compartido con el flujo privado). Ruta: delegado (mismo writer).
- [x] T4 (backend/edición bio-specialty): `UpdateProfileDto` con `bio?` (`@MaxLength(500)`) y `specialty?` (`@MaxLength(120)`); `ProfileService.update` los persiste con chequeo `!== undefined` (permite vaciar con `''`, a diferencia del chequeo truthy de `name`) para poder borrar bio/specialty. Ruta: delegado (mismo writer).
- [x] T5 (frontend/API cliente): `getPublicTherapistProfile`/`getPublicTherapistAvatarUrl` en `api/publicScheduling.ts`, hook `usePublicTherapistProfile` en `hooks/usePublicScheduling.ts`. Ruta: delegado (writer frontend).
- [x] T6 (frontend/UI PublicBookingPage): componente `TherapistProfileHeader` antes del `<h2>Agenda tu sesión</h2>` (avatar/iniciales, badge specialty, bio); `return null` en loading/error, degradación graciosa sin bloquear booking. Ruta: delegado (mismo writer frontend).
- [x] T7 (frontend/ProfilePage): bloque "Perfil público" en `AccountDataForm` con input specialty (120) y textarea bio (500, contador), mismo patrón de estado/PATCH que el form de nombre existente. Ruta: delegado (mismo writer frontend).

## Verificación por tarea
- Backend: `cd backend && npx prisma validate`, `npm run build`, `npm test` (si aplica al módulo tocado).
- Frontend: `cd frontend && npm run build`, `npm run lint` (si existe).

## Progreso
- 2026-09-21: exploración completa (agente Explore), decisión de storage tomada con el usuario, tasks creadas.
- 2026-09-21: T1-T4 (backend) completo. `npm run build` OK, `npm test -- profile public-scheduling public-therapist-profile` → 12 suites/97 tests OK. Full suite: 673 OK, 14 fallas pre-existentes en `*.integration.spec.ts` (falta `DATABASE_URL`/`DIRECT_URL` en este worktree, no relacionado al cambio). Commit `b6e6a08`.
- 2026-09-21: T5-T7 (frontend) completo. `npm run build` OK, `npm run lint` OK. No había tests existentes de estos archivos.

## Próximo paso
Commit de work-unit frontend (T5-T7). Feature completa (T1-T7) — falta decidir con el usuario si se abre PR ahora.
