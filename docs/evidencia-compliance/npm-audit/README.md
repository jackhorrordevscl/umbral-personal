# Línea base de `npm audit`

Snapshot completo (`npm audit`, sin `--omit=dev` ni filtro de severidad) tomado el 2026-09-24, antes de congelar el proyecto. CI solo corre `--omit=dev --audit-level=high` mientras hay PRs activos.

| Paquete  | Total | Moderate | High | Solo producción (`--omit=dev`) |
|----------|-------|----------|------|--------------------------------|
| backend  | 4     | 1        | 3    | 1 moderate                     |
| frontend | 30    | 28       | 2    | 25 moderate                    |

Archivos: `backend-2026-09-24.txt`, `frontend-2026-09-24.txt`.

Para comparar en el futuro: correr `npm audit` en cada paquete y contrastar con estos archivos.
