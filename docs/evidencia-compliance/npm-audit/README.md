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
