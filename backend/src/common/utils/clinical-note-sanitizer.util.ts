import sanitizeHtml from 'sanitize-html';

// Issue #159: las notas clínicas (consultReason/intervention/agreements) se
// persisten como HTML enriquecido por Tiptap en el frontend. Whitelist
// mínima -- solo el formato que el editor expone (negrita/cursiva/subrayado/
// párrafos/listas) -- para que un payload manual no pueda inyectar <script>,
// atributos on*, ni estilos/iframes.
const CLINICAL_NOTE_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li'],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
};

export function sanitizeClinicalNote(value: string): string;
export function sanitizeClinicalNote(
  value: string | null | undefined,
): string | null | undefined;
export function sanitizeClinicalNote(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined) {
    return value;
  }
  return sanitizeHtml(value, CLINICAL_NOTE_SANITIZE_OPTIONS);
}
