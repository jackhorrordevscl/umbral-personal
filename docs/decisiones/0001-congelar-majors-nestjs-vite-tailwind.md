# ADR 0001 — Congelar NestJS 11, Vite 7 y Tailwind 3 hasta después de la v1

- **Estado:** aceptada
- **Fecha:** 2026-09-25
- **Issue:** #210

## Contexto

Contra el registro npm (2026-09-25), tres dependencias core están un major
por detrás:

| Paquete | En el repo | Última versión |
| --- | --- | --- |
| `@nestjs/core` | `^11.0.1` | 12.1.0 |
| `vite` | `^7.3.1` | 8.3.1 |
| `tailwindcss` | `^3.4.19` | 4.3.3 (dos majors) |

La aplicación funciona con estas versiones y ninguna tiene una vulnerabilidad
sin parche que nos afecte. Migrar los tres a la vez, con el freeze de v1
cerca, mezclaría riesgo de regresión con trabajo de compliance.

## Decisión

Mantener estas versiones **de forma deliberada** hasta después de la v1. Es una
decisión de calendario, no un descuido. Prisma se gestiona aparte en el
issue #75.

## Qué no significa

"Congelado" no es "sin mirar". Que no exista una CVE reportada hoy no implica
que no vaya a aparecer. Mientras dure el congelamiento:

1. Se sigue corriendo `npm audit` en `backend/` y `frontend/`. La línea base
   está en `docs/evidencia-compliance/npm-audit/`.
2. Los parches dentro del mismo major (11.x, 7.x, 3.x) se aplican de forma
   normal.
3. Una vulnerabilidad `high` o `critical` sin parche en el major actual anula
   este ADR y obliga a migrar.

## Revisión

Reabrir esta decisión después del freeze de v1, o antes si se cumple el punto 3.
Al migrar, hacerlo un paquete por PR (NestJS, Vite, Tailwind) y actualizar o
reemplazar este ADR.
