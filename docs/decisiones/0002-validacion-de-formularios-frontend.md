# ADR 0002 — Validación de formularios en el frontend

- **Estado:** aceptada
- **Fecha:** 2026-09-25
- **Issue:** #201

## Contexto

El frontend valida formularios de dos maneras:

- **`react-hook-form` + `zod`:** Login, Signup, ForgotPassword, ResetPassword,
  MfaRecover, el formulario público de reservas y los editores de
  disponibilidad.
- **A mano, con `useState`:** `PatientsPage`, `PaymentsPage`, `SharedFilesPage`
  y `ProfilePage`.

El riesgo señalado es que un arreglo de validación se aplique en un lado y no
en el otro.

## Decisión

No migrar ahora las páginas validadas a mano. Se mantiene esta convención:

1. **Formularios nuevos:** `react-hook-form` + `zod`.
2. **Formularios existentes validados a mano:** se dejan como están hasta que
   se toquen por otro motivo; entonces se migran en ese mismo cambio.
3. **Lógica de validación no trivial:** vive siempre en una función pura
   compartida y no dentro del componente. Hoy es así para `validateRut`
   (`src/utils/rut.ts`). Si dos formularios necesitan la misma regla, se
   comparte la función, no se copia.

## Por qué

- Lo que se valida a mano son sobre todo campos obligatorios y unos pocos
  formatos (el RUT ya usa una función compartida; el de las credenciales de
  Flow es una constante local de `PaymentsPage`), así que el riesgo de
  divergencia es bajo.
- Reescribir formularios grandes (`PatientsPage`, `ProfilePage`) sin cambio
  funcional cerca del freeze de v1 suma riesgo de regresión sin beneficio para
  el usuario.
- El backend valida de todos modos con `class-validator`; la validación del
  cliente es de experiencia de uso, no una barrera de seguridad.

## Revisión

Reabrir si una regla de validación se corrige en un formulario y se descubre
duplicada en otro, o al planificar el trabajo posterior a la v1.
