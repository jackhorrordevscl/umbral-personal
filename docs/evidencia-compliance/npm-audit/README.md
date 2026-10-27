# Línea base de `npm audit`

Snapshot completo (`npm audit`, sin `--omit=dev` ni filtro de severidad) tomado el 2026-09-24, antes de congelar el proyecto. CI solo corre `--omit=dev --audit-level=high` mientras hay PRs activos.

| Paquete  | Total | Moderate | High | Solo producción (`--omit=dev`) |
|----------|-------|----------|------|--------------------------------|
| backend  | 4     | 1        | 3    | 1 moderate                     |
| frontend | 30    | 28       | 2    | 25 moderate                    |

Archivos: `backend-2026-09-24.txt`, `frontend-2026-09-24.txt`.

Para comparar en el futuro: correr `npm audit` en cada paquete y contrastar con estos archivos.

## Estado posterior al 2026-09-25

Los snapshots y las cifras de la línea base de arriba no se modifican. Después de esa fecha se resolvieron:

- #253: `sanitize-html` actualizado a 2.17.7.
- #254: migración a Tiptap 3.
- #256: `vitest` actualizado a 4.1.11.
- #257: `js-yaml` (transitiva) pasó del rango afectado 4.0.0 - 4.3.1 a 4.3.2, y `nanoid` (transitiva) del rango afectado <3.3.18 a 3.3.19. Ambas versiones se verificaron en `package-lock.json` de backend y frontend.

`esbuild` quedó fijado en 0.28.1 (#230).

## Verificación al 2026-10-16 (v1.0.0)

Las cifras de la línea base y los snapshots de arriba no se modifican. Se corrió `npm audit` otra vez sobre los `package-lock.json` de la rama con el código de v1.0.0; el resultado depende de la base de avisos de npm del día, así que puede cambiar sin que cambie el código.

| Paquete  | Comando | Resultado |
|----------|---------|-----------|
| backend  | `npm audit --omit=dev` (lo que valida CI) | 0 vulnerabilidades |
| backend  | `npm audit` (completo) | 23: 19 moderate y 4 high; las 4 high están bajo `prisma` 7.10.0, que es una devDependency (`prisma`, `@prisma/config`, `deepmerge-ts` y `mysql2`) |
| frontend | `npm audit --omit=dev` | 0 vulnerabilidades |
| frontend | `npm audit` (completo) | 0 vulnerabilidades |

Versiones verificadas en los `package-lock.json`: `sanitize-html` 2.17.7 (backend), `vitest` 4.1.11 (frontend), `esbuild` 0.28.1 (frontend), `js-yaml` 4.3.2 y `nanoid` 3.3.19 (ambos paquetes) y `@tiptap/core` 3.31.3 (frontend). CI sigue corriendo `npm audit --omit=dev --audit-level=high` en backend y frontend (`.github/workflows/ci.yml`).

## Verificación al 2026-10-27

Las cifras de la línea base y los snapshots de arriba no se modifican. Se corrió `npm audit` (solo lectura, sin instalar) sobre los `package-lock.json` de `main` en `733181a`. El resultado depende de la base de avisos de npm del día, así que puede cambiar sin que cambie el código.

| Paquete  | Comando | Resultado |
|----------|---------|-----------|
| backend  | `npm audit --omit=dev` (lo que valida CI, con `--audit-level=high`) | 1 moderate: `sanitize-html` 2.17.7 (rango afectado `<=2.17.7`, corrección disponible); CI no lo bloquea porque el umbral es high |
| backend  | `npm audit` (completo) | 6: 2 moderate (`sanitize-html` y `fast-uri`) y 4 high; las 4 high están bajo `prisma` 7.10.0, que es una devDependency (`prisma`, `@prisma/config`, `deepmerge-ts` y `mysql2`) |
| frontend | `npm audit --omit=dev` | 0 vulnerabilidades |
| frontend | `npm audit` (completo) | 5: 3 moderate (`vitest` 4.1.11, `@vitest/coverage-v8` y `@vitest/mocker`) y 2 high (`vite` 7.3.6 y `undici` 8.11.2, transitiva); todas son de desarrollo |

Versiones verificadas en los `package-lock.json`: `sanitize-html` 2.17.7 (backend), `vitest` 4.1.11, `vite` 7.3.6, `esbuild` 0.28.1 y `@tiptap/core` 3.31.3 (frontend), y `js-yaml` 4.3.2 y `nanoid` 3.3.19 (ambos paquetes). Las cifras de la verificación del 2026-10-16 ya no coinciden: `sanitize-html` 2.17.7 y `vitest` 4.1.11 siguen en el rango afectado de avisos que esa fecha no reportaba. El seguimiento de estos avisos no está registrado en este documento.
