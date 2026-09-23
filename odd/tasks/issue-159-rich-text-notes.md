# Issue #159: Notas clínicas con formato enriquecido (rich text)

## Objetivo
Reemplazar los `<textarea>` planos de `consultReason`, `intervention` y `agreements` en `Consultation` por un editor rich-text (Tiptap), persistiendo el contenido como **HTML sanitizado**.

## Por qué
Encuadrado (comparación de mercado) permite negrita/cursiva/subrayado en las notas clínicas. Prioridad baja, sin gasto nuevo (free tier).

## Decisión de producto (resuelta)
- **Formato de persistencia: HTML sanitizado** (no JSON de bloques). Confirmado por el usuario 2026-09-23.
- Editor: Tiptap (sugerido en el issue, sin licencia paga necesaria para lo básico: bold/italic/underline).

## Alcance
1. Backend: agregar `sanitize-html`, sanitizar `consultReason`/`intervention`/`agreements` en create y correct de `Consultation` antes de persistir (whitelist mínima: `p, br, strong, em, u, ul, ol, li`).
2. Frontend: instalar Tiptap, reemplazar textareas en:
   - `frontend/src/components/consultations/ConsultationForm.tsx:177-194` (creación)
   - `frontend/src/pages/ConsultationsPage.tsx:438-451` (corrección)
3. Frontend: renderizar HTML sanitizado (DOMPurify en cliente, defensa en profundidad) en:
   - `ConsultationsPage.tsx` vista vigente (líneas ~605-614, `ExpandableText`)
   - `ConsultationsPage.tsx` snapshot histórico de correcciones (líneas ~654-663)
4. Backend PDF (`reports.service.ts:179,188,195`): `pdfkit` no interpreta HTML. Convertir el HTML sanitizado (bold/italic/underline/párrafos/listas) a las llamadas de `pdfkit` correspondientes, o como mínimo extraer texto plano legible sin perder el contenido.
5. Tests: backend (sanitización en el DTO/servicio, jest) y frontend (render del editor y de las vistas, vitest) para los casos con y sin formato.

## Fuera de alcance
- Formato avanzado (tablas, imágenes, colores). Solo negrita/cursiva/subrayado/listas, según el issue.
- Migración de datos históricos (el texto plano existente ya es HTML-safe como texto, no requiere migración).

## Constraints
- No introducir XSS: sanitizar en el backend (fuente de verdad) y también al renderizar en frontend (defensa en profundidad).
- `agreements` sigue siendo opcional.

## TDD
- Sin convención de TDD forzada en el repo (no hay CLAUDE.md que lo exija). Se usan checks funcionales ordinarios: `backend` → Jest, `frontend` → Vitest.

## Tareas
- [x] T1 — Backend: instalar `sanitize-html` (+ tipos), sanitizar en `consultations.service.ts` (create ~147-149, correct ~398-400) con whitelist mínima. Test Jest de sanitización (tags permitidos pasan, `<script>`/`onerror` se eliminan).
  - Commit `c6a3869`. `sanitize-html` pinneado en `2.13.0` (no `2.17.x`) porque su dependencia `htmlparser2@12` es ESM-only y rompe Jest/ts-jest en cascada (htmlparser2→domhandler→domutils→dom-serializer); las 3 CVEs moderadas de `2.13.0`-`2.17.6` son sobre bypass vía atributos/tags (`action`/`formaction`/svg/`textarea`) que la whitelist de este util no permite (cero atributos, solo `p/br/strong/em/u/ul/ol/li`), así que el riesgo no aplica a este uso.
  - Tests: 6 nuevos (`clinical-note-sanitizer.util.spec.ts`) + 45 unitarios de `consultations.service.spec.ts` pasan. La suite de integración (`consultations.service.integration.spec.ts`) requiere `DATABASE_URL` real y no corrió (ambiental, no relacionado a este cambio). Typecheck limpio (`tsc --noEmit`).
- [x] T2 — Frontend: instalar Tiptap (`@tiptap/react`, `@tiptap/starter-kit`), crear componente `RichTextEditor` reutilizable con toolbar mínima (bold/italic/underline).
  - Instalado `@tiptap/react@^2.27.3`, `@tiptap/starter-kit@^2.27.3`, `@tiptap/extension-underline@^2.27.3`, `dompurify@^3.4.15` (sin `@types/dompurify`: dompurify v3 ya trae sus propios tipos, package.json no lo lista).
  - Componente creado en `frontend/src/components/ui/RichTextEditor.tsx` (carpeta `ui/`, siguiendo la convención de otros reutilizables como `FormField`/`ErrorBanner`/`Modal`; estilo de comillas dobles como el resto de `ui/`). Recibe `value`/`onChange(html)` controlados (sin migrar a react-hook-form, fuera de alcance) + `ariaLabel` opcional para nombre accesible (ver nota T3/T4/T7).
  - StarterKit configurado con `heading/blockquote/codeBlock/horizontalRule/strike: false` para acotar el editor a bold/italic/underline/listas/párrafos, calzando 1:1 con la whitelist del backend.
- [x] T3 — Frontend: integrar `RichTextEditor` en `ConsultationForm.tsx` (creación) reemplazando los 3 textareas.
- [x] T4 — Frontend: integrar `RichTextEditor` en el formulario de corrección de `ConsultationsPage.tsx`.
  - Decisión: `<label htmlFor>` no etiqueta un `<div contenteditable>` (no es "labelable" según el spec HTML, a diferencia de `<textarea>`). Se agregó `role="textbox"` + `aria-label` (prop `ariaLabel`) al div editable de ProseMirror para mantener accesibilidad real y testabilidad (`getByRole('textbox', { name })`).
- [x] T5 — Frontend: renderizar HTML sanitizado (DOMPurify) en la vista vigente y en el snapshot histórico de `ConsultationsPage.tsx`.
  - `sanitizeClinicalNoteHtml()` (misma whitelist que el backend: `p, br, strong, em, u, ul, ol, li`, sin atributos) aplicada en `ExpandableText` (vista vigente) y en el snapshot de `h.snapshot.*` (antes `<p>{texto}</p>` plano). `ExpandableText` ahora mide el umbral de "ver más" sobre el texto plano (sin tags) para no truncar de más por el HTML.
- [x] T6 — Backend: adaptar `reports.service.ts` para convertir el HTML de las 3 notas a salida legible en el PDF (pdfkit), sin perder negrita/cursiva/listas si es viable, o texto plano limpio como mínimo.
  - Se logró el nivel alto (no solo el mínimo): `backend/src/modules/reports/clinical-note-pdf.util.ts` — parser propio (no se agregó dependencia nueva; la whitelist es acotada y sin atributos) que tokeniza el HTML sanitizado en líneas con "runs" con estilo (bold/italic/underline), decodifica entidades básicas (`&amp;`, `&lt;`, etc.), separa párrafos/`<br>`/`<li>` en líneas, numera `<ol>` y usa viñeta `•` en `<ul>`. `renderClinicalNoteToPdf()` vuelca esas líneas a pdfkit con `doc.font(...)`/`doc.text(..., { continued: true, underline })` encadenando runs en la misma línea. Compatible con texto plano heredado (notas previas al editor, sin tags): queda como una línea con un solo run sin estilo, igual que antes.
  - Wireado en `generatePatientReport` reemplazando los 3 bloques de `doc.text(c.consultReason/intervention/agreements, {...})` planos. `agreements` vacío sigue usando el placeholder `'Ninguno'` (sin pasar por el parser).
- [x] T7 — Tests frontend (Vitest) de los puntos de renderizado y del formulario.
  - Nuevo `frontend/src/components/ui/RichTextEditor.spec.tsx` (3 tests): renderiza HTML inicial + nombre accesible, `onChange` se llama con el HTML resultante al escribir y aplicar negrita, resincroniza cuando `value` cambia desde afuera.
  - Nuevo test en `frontend/src/pages/ConsultationsPage.spec.tsx`: sanitización defensa-en-profundidad (HTML con `<script>`/`<img onerror>` se limpia antes de `dangerouslySetInnerHTML`, el `<strong>` legítimo se preserva).
  - Actualizados (rotos por el cambio de `<textarea>` a `<div contenteditable role="textbox">`, no por regresión): `ConsultationsPage.spec.tsx` (`getByLabelText` → `getByRole('textbox', { name })`; el payload esperado del POST ahora es HTML `<p>...</p>`, no texto plano) y `CalendarPage.spec.tsx` (mismo cambio de query, ese formulario reusa `ConsultationForm`).
  - Descubrimiento no trivial: escribir en el editor via `userEvent.type` lanzaba una excepción no capturada en jsdom (`elementFromPoint`/`getClientRects` no implementados, usados por ProseMirror al hacer scroll a la selección) que abortaba la transacción ANTES de emitir `update` — el texto quedaba insertado en el DOM pero `onChange` nunca se llamaba. Se agregaron polyfills mínimos (solo si faltan) en `frontend/src/test/setup.ts` para `Range.prototype.getClientRects/getBoundingClientRect` y `document.elementFromPoint`. No afecta ningún otro test.
  - Backend: nuevo `backend/src/modules/reports/clinical-note-pdf.util.spec.ts` (10 tests: parser + renderer con doc fake) y un test nuevo en `reports.service.spec.ts` que genera un PDF real con notas HTML enriquecidas (bold/italic/underline/lista) y verifica que no rompe (`%PDF-` + buffer no vacío).

## Verificación ejecutada
- Backend: `npx tsc --noEmit` → limpio. `npx jest src/modules/reports src/common/utils/clinical-note-sanitizer.util.spec.ts --no-coverage` → 3 suites, 21 tests, todos pasan. `npx jest src/modules/consultations --no-coverage` → 43/43 pasan en los specs unitarios; `consultations.service.integration.spec.ts` sigue fallando por falta de `DATABASE_URL` (ambiental, preexistente de T1, no tocado en esta tanda). `npx eslint` sobre los archivos tocados → limpio (se corrigieron 7 hallazgos de formato con `--fix`, todos `prettier/prettier`).
- Frontend: `npm test` (vitest con `cross-env NODE_OPTIONS=--no-experimental-webstorage`, el script real del repo) → 24 archivos, 145 tests, todos pasan. `npx tsc --noEmit` → limpio. `npx eslint` sobre los archivos tocados → limpio (0 errores/warnings).

## Fuera de alcance / limitaciones conocidas
- No se migró ningún formulario a react-hook-form (explícitamente fuera de alcance).
- El PDF no reproduce fuentes/tamaños distintos más allá de bold/italic/underline (no era parte del alcance del issue).
- `consultations.service.integration.spec.ts` no corrió (requiere `DATABASE_URL` real); no es una regresión de esta tarea.

## Ruta de implementación
- T1, T6: inline (1-3 archivos, ya entendidos) o delegado según evolución.
- T2-T5: delegado (2+ archivos no triviales, requiere research de API de Tiptap).
- T7: junto con T2-T5.

## Evidencia / commits
(se completa con los hashes tras el commit)
