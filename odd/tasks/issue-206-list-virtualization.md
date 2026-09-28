---
feature: issue-206-list-virtualization
status: in_progress
---

# Issue #206 — Virtualización de listas de pacientes/consultas

## Objetivo
Resolver el issue #206 (impacto medio, performance) mediante virtualización
client-side con `react-window`, sin tocar el backend ni el contrato de la
API (decisión tomada con el usuario: la búsqueda sigue siendo client-side
sobre el array completo ya cargado; paginación server-side queda descartada
porque rompería la búsqueda salvo que también se mueva al backend, fuera de
alcance de este issue).

## Por qué
`PatientsPage.tsx` renderiza la tabla desktop y las cards móvil con
`filtered.map(...)` sin ventana visible: con años de datos acumulados,
cientos de `<tr>`/cards quedan montados en el DOM a la vez. `usePatients`/
`filterPatients` ya tienen `useMemo` (PR #264, no hace falta tocarlos).

## Alcance
- Agregar dependencia `react-window` en `frontend/package.json`.
- Virtualizar la tabla desktop de `frontend/src/pages/PatientsPage.tsx`
  (líneas ~344-442 en la exploración) y las cards móvil (~445 en adelante).
- Revisar `frontend/src/pages/ConsultationsPage.tsx`: tiene un selector de
  pacientes (`filteredPatients`, `showPatientList`) que puede tener el mismo
  problema — confirmar tamaño real de esa lista antes de decidir si aplica.
- Mantener el buscador (`search` state) funcionando exactamente igual.
- Ajustar tests existentes (`PatientsPage.spec.tsx`, y `ConsultationsPage.spec.tsx`
  si aplica) para que sigan pasando con listas virtualizadas — gotcha conocido:
  react-window necesita alto/ancho de contenedor definido, jsdom no calcula
  layout real, puede requerir mockear `getBoundingClientRect` o fijar
  `height`/`width` explícitos en el componente.

## Fuera de alcance
- Backend: no tocar `patients.service.ts`, `patients.controller.ts`, ni
  `api/patients.ts` (`listPatients`).
- No mover la búsqueda al servidor.

## Tareas
- [x] T1: Instalado `react-window@2.3.3` (trae sus propios tipos TS, no
      hace falta `@types/react-window`). API v2 (`List`/`rowComponent`),
      distinta de la v1 (`FixedSizeList`) que describían las fuentes viejas.
- [x] T2: Virtualizada la tabla desktop de `PatientsPage.tsx`. Se reemplazó
      el `<table>` semántico por un layout de grid con roles ARIA
      (`role="table"/"row"/"columnheader"/"cell"`): un `<tr>` posicionado
      con `position:absolute` (lo que hace `List` internamente) rompe la
      sincronización de anchos de columna con el resto de las filas, así
      que header y cada fila comparten el mismo `grid-template-columns`
      inline (constante `PATIENT_TABLE_COLUMNS`) como única fuente de
      verdad.
- [x] T3: Virtualizadas las cards móvil con el mismo `List`, altura fija
      (`PATIENT_CARD_ROW_HEIGHT`) pensada para la variante más alta (con
      checkbox de consentimiento retroactivo); cards sin esa línea quedan
      con un poco de espacio de sobra en vez de recortarse.
- [x] T4: Evaluado el selector de pacientes en `ConsultationsPage.tsx`
      (`filteredPatients.map`, línea ~585). Decisión: NO virtualizar. Ya es
      un dropdown colapsable (`showPatientList`, cerrado por defecto) con
      `max-h-64 lg:max-h-96 overflow-auto` — acotado y normalmente ni
      montado. El costo de otra integración de react-window no se justifica
      frente al beneficio marginal.
- [x] T5: No hizo falta tocar ningún test. Los 9 tests de
      `PatientsPage.spec.tsx` pasaron sin cambios: react-window v2 solo
      mide el contenedor por `ResizeObserver` cuando NO se le da una altura
      numérica explícita en `style` (confirmado leyendo
      `node_modules/react-window/dist/react-window.js`: para un `List`
      vertical, el modo es `"only-height"` y si `style.height` es un número
      o termina en "px", el observer nunca se crea). Como el código ya pasa
      `style={{ height: PATIENT_LIST_HEIGHT }}`, jsdom nunca necesita medir
      nada — no se requirió ningún mock.
- [x] T6: Lint + typecheck + tests + build del frontend, todo en verde
      (evidencia abajo).
- [x] T7: Commit creado en la rama del worktree
      (`worktree-issue-206-list-pagination`), sin atribución IA. Closes #206.

## Evidencia de verificación (2026-09-27/28)
- `npx tsc --noEmit -p .` → sin salida, exit 0.
- `npm run lint` → sin errores/warnings.
- `npx vitest run PatientsPage` → 1 archivo, 9 tests, todos en verde.
- `npx vitest run` (suite completa) → 40 archivos, 215 tests, todos en verde.
- `npm run build` → `✓ built in 15.03s` (el `Assertion failed:
  !(handle->flags & UV_HANDLE_CLOSING)` que imprime al final es un problema
  conocido de Node/libuv al cerrar el proceso en Windows, ocurre después de
  que el build ya terminó bien; no es un fallo de esta build).

## Verificación
- `cd frontend && npm run lint`
- `cd frontend && npm run build` (o `tsc --noEmit` si build es más lento)
- `cd frontend && npx jest PatientsPage ConsultationsPage` (o el runner que
  use el repo)

## TDD
Modo no confirmado explícitamente por el usuario en esta sesión; el repo
tiene tests existentes que deben seguir en verde. No es obligatorio escribir
un test nuevo que falle primero (no se pidió TDD estricto), pero si se agrega
un test de que la lista larga renderiza solo un subconjunto de filas, seguir
RED→GREEN para ese test puntual.
