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
- [ ] T1 — Backend: instalar `sanitize-html` (+ tipos), sanitizar en `consultations.service.ts` (create ~147-149, correct ~398-400) con whitelist mínima. Test Jest de sanitización (tags permitidos pasan, `<script>`/`onerror` se eliminan).
- [ ] T2 — Frontend: instalar Tiptap (`@tiptap/react`, `@tiptap/starter-kit`), crear componente `RichTextEditor` reutilizable con toolbar mínima (bold/italic/underline).
- [ ] T3 — Frontend: integrar `RichTextEditor` en `ConsultationForm.tsx` (creación) reemplazando los 3 textareas.
- [ ] T4 — Frontend: integrar `RichTextEditor` en el formulario de corrección de `ConsultationsPage.tsx`.
- [ ] T5 — Frontend: renderizar HTML sanitizado (DOMPurify) en la vista vigente y en el snapshot histórico de `ConsultationsPage.tsx`.
- [ ] T6 — Backend: adaptar `reports.service.ts` para convertir el HTML de las 3 notas a salida legible en el PDF (pdfkit), sin perder negrita/cursiva/listas si es viable, o texto plano limpio como mínimo.
- [ ] T7 — Tests frontend (Vitest) de los puntos de renderizado y del formulario.

## Ruta de implementación
- T1, T6: inline (1-3 archivos, ya entendidos) o delegado según evolución.
- T2-T5: delegado (2+ archivos no triviales, requiere research de API de Tiptap).
- T7: junto con T2-T5.

## Evidencia / commits
(se completa por tarea)
