# Migración de shared-files a Backblaze B2

## Objetivo
Migrar el storage de `SharedFile` de disco local (`uploads/shared/`, efímero en Render free) a
Backblaze B2, mismo patrón ya aplicado a avatares (issue #170, `avatar-storage.util.ts`).

## Por qué
Render free no tiene disco persistente. Los shared-files subidos por terapeutas se pierden en
cada deploy aunque el registro en DB (`SharedFile`) sobreviva. El issue #170 original cubría
avatares y shared-files; se cerró con solo avatares migrados (decisión deliberada del usuario de
acotar alcance). Esto ataca la parte pendiente.

## Alcance
- Nuevo `backend/src/common/utils/shared-file-storage.util.ts`, espejo de `avatar-storage.util.ts`,
  pero indexado por `objectKey` (UUID por archivo) en vez de por `userId`.
- `shared-files.module.ts`: multer pasa de `diskStorage` a `memoryStorage` (buffer en RAM, nunca
  toca disco).
- `shared-files.service.ts`: upload sube el buffer a B2 (genera `objectKey`, lo guarda en el campo
  `filename` ya existente — **sin migración de Prisma**); download lee de B2 en vez de
  `res.sendFile`; si el objeto no está en B2 (archivos viejos ya perdidos por el disco efímero),
  responder 404 en vez de 500 (mismo fix que PR #169 para avatares).
- `shared-files.controller.ts`: ajustar el método de download para servir el buffer leído
  (`res.send(buffer)` + headers) en vez de `res.sendFile(path)`.
- `shared-files.service.spec.ts`: actualizar mocks de filesystem por mocks del nuevo storage util.
- `README.md`: documentar `B2_SHARED_FILES_ENDPOINT/REGION/BUCKET/KEY_ID/APPLICATION_KEY`, mismo
  estilo que la sección de `B2_AVATARS_*`.

**Fuera de alcance**: no se toca el contrato HTTP (controller/frontend quedan iguales), no se
migran archivos ya subidos (se perdieron con el disco efímero, no hay nada que backfillear), no se
agrega delete físico en B2 al soft-delete existente (mismo comportamiento actual, se puede evaluar
después si hace falta).

## Constraints
- Reutilizar el campo `filename` existente del modelo `SharedFile` como `objectKey` — cero cambios
  de schema/migración.
- Mantener la misma interfaz pública que consumen controller/frontend.
- Credenciales ya cargadas por el usuario en `backend/.env` local
  (`B2_SHARED_FILES_ENDPOINT/REGION/BUCKET/KEY_ID/APPLICATION_KEY`); en Render se cargan aparte
  (dashboard), documentar en README el mismo estilo que `B2_AVATARS_*`.

## Ruta de implementación
Delegated direct — un solo writer bounded (writer trigger: 4+ archivos no triviales tocados:
util nuevo, module, service, controller, spec, README).

## TDD
Sin modo TDD explícito configurado en el proyecto para esta sesión; se corre la suite existente
(`shared-files.service.spec.ts`) tras el cambio como verificación funcional ordinaria.

## Tareas
- [x] T1: Crear `shared-file-storage.util.ts` (readSharedFileBuffer/writeSharedFileBuffer/
      deleteSharedFileObject/isSharedFileNotFoundError), espejo de `avatar-storage.util.ts`
- [x] T2: Cambiar `shared-files.module.ts` a `memoryStorage()`
- [x] T3: Actualizar `shared-files.service.ts` (upload/download usan el buffer + B2 en vez de fs)
- [x] T4: Actualizar `shared-files.controller.ts` (download sirve buffer en vez de sendFile)
- [x] T5: Actualizar `shared-files.service.spec.ts` (mock del storage util, no de fs)
- [x] T6: Documentar `B2_SHARED_FILES_*` en README.md
- [x] T7: Correr `npm test -- shared-files` y `npm run build` (backend) para verificar
- [x] T8: Commit en rama de feature (`shared-files-b2-migration`), Conventional Commit, Closes #170

## Progreso
Iniciado 2026-09-22. Mapeo completo de la feature ya hecho (service, controller, modelo Prisma,
tests, frontend, README) — ver conversación.

Implementación completa en una sola sesión (T1-T8):
- `backend/src/common/utils/shared-file-storage.util.ts` (nuevo): espejo de `avatar-storage.util.ts`
  indexado por `objectKey` en vez de `userId`.
- `shared-files.module.ts`: `diskStorage` → `memoryStorage()`.
- `shared-files.service.ts`: `uploadFile` valida `file.buffer` en memoria y sube a B2
  (`objectKey = randomUUID() + extname`, guardado en el campo `filename` existente, sin cambio de
  schema); `getFilePath` reemplazado por `getFileBuffer` (lee de B2, 404 vía `isSharedFileNotFoundError`
  si el objeto no está, mismo fix que PR #169).
- `shared-files.controller.ts`: el endpoint de download sirve el buffer (`res.end(buffer)`) en vez de
  `res.sendFile`.
- `shared-files.service.spec.ts`: mock de `shared-file-storage.util.ts`, tests existentes intactos +
  3 tests nuevos para `getFileBuffer` (incluye el caso "registro en DB pero objeto no está en B2" → 404).
- `README.md`: documentada la sección `B2_SHARED_FILES_*` junto a `B2_AVATARS_*`.

Verificación (entorno requirió `npm install` + `npx prisma generate` primero — `@aws-sdk/client-s3`
no estaba instalado y el Prisma Client estaba desactualizado respecto al schema, ambos pre-existentes
y no relacionados a este cambio):
- `npx tsc --noEmit`: sin errores.
- `npx jest shared-files`: 6/6 tests pasan.
- `npm run build`: build limpio.

Commit: `37c6313` — "fix(shared-files): migrar storage a Backblaze B2" (rama
`shared-files-b2-migration`). Sin push ni PR (decisión del usuario).
