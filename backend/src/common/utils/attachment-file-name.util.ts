const MAX_BASE_NAME_LENGTH = 80;
const DEFAULT_BASE_NAME = 'documento';
const EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,8}$/;

// multer entrega `originalname` decodificado como latin1: un nombre UTF-8 con
// tildes llega como "sesiÃ³n". Se revierte solo si la reinterpretación es
// UTF-8 válida; un nombre que ya trae caracteres fuera de latin1 se deja igual.
function recoverUtf8(original: string): string {
  if ([...original].some((char) => char.charCodeAt(0) > 0xff)) {
    return original;
  }
  const decoded = Buffer.from(original, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? original : decoded;
}

// Deja un nombre seguro para guardar y para Content-Disposition: sin
// directorios, solo letras, números, espacios y . _ ( ) -, largo acotado y con
// la extensión original (en minúsculas) solo si es corta y alfanumérica.
export function sanitizeAttachmentFileName(
  original: string | undefined,
): string {
  const lastSegment =
    recoverUtf8(original ?? '')
      .normalize('NFC')
      .split(/[\\/]/)
      .pop() ?? '';
  const extension = EXTENSION_PATTERN.exec(lastSegment)?.[0] ?? '';
  const base = extension
    ? lastSegment.slice(0, -extension.length)
    : lastSegment;
  const cleaned = base
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/^[.\s_]+|[.\s]+$/g, '')
    .slice(0, MAX_BASE_NAME_LENGTH)
    .trim();
  return `${cleaned || DEFAULT_BASE_NAME}${extension.toLowerCase()}`;
}

// RFC 6266 / RFC 5987: `filename` ASCII de respaldo para clientes viejos y
// `filename*` en UTF-8 para conservar las tildes.
export function contentDispositionAttachment(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
