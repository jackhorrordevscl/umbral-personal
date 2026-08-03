import { BadRequestException } from '@nestjs/common';

// El `mimetype` declarado por el cliente en el upload multipart es un header
// controlado por el atacante y trivialmente falseable (issue #51). Esta
// utilidad valida el contenido real del archivo vía magic bytes
// (`file-type`) y lo compara contra el mimetype declarado, en vez de confiar
// ciegamente en él.
//
// `file-type` no distingue variantes viejas de Office (.doc/.xls/.ppt): todas
// comparten el contenedor "Compound File Binary" y se detectan como
// `application/x-cfb` sin importar cuál sea. Tampoco puede detectar texto
// plano por firma (no tiene magic bytes). Por eso el mapeo es de "familia
// detectada" -> lista de mimetypes declarados compatibles, no 1:1.
const DETECTED_TO_ALLOWED_DECLARED: Record<string, string[]> = {
  'application/pdf': ['application/pdf'],
  'image/jpeg': ['image/jpeg'],
  'image/png': ['image/png'],
  'image/gif': ['image/gif'],
  'image/webp': ['image/webp'],
  'application/x-cfb': [
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
  ],
  'application/zip': [
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
};

// Heurística para texto plano: sin magic bytes propios, se acepta solo si el
// contenido no tiene bytes de control no imprimibles (indicio de binario
// disfrazado de .txt).
function looksLikePlainText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  for (const byte of sample) {
    const isPrintableAscii = byte >= 0x20 && byte <= 0x7e;
    const isWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    const isUtf8Continuation = byte >= 0x80;
    if (!isPrintableAscii && !isWhitespace && !isUtf8Continuation) {
      return false;
    }
  }
  return true;
}

// Lanza `BadRequestException` si el contenido real del archivo no coincide
// con el `declaredMimetype` que mandó el cliente. Usar SIEMPRE con el buffer
// completo ya recibido (memoria o leído de disco), nunca durante el streaming
// del upload.
export async function assertFileContentMatchesMimetype(
  buffer: Buffer,
  declaredMimetype: string,
): Promise<void> {
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(buffer);

  if (!detected) {
    if (declaredMimetype === 'text/plain' && looksLikePlainText(buffer)) {
      return;
    }
    throw new BadRequestException(
      'El contenido del archivo no coincide con el tipo declarado',
    );
  }

  const compatibleDeclaredMimetypes =
    DETECTED_TO_ALLOWED_DECLARED[detected.mime];
  if (
    !compatibleDeclaredMimetypes ||
    !compatibleDeclaredMimetypes.includes(declaredMimetype)
  ) {
    throw new BadRequestException(
      'El contenido del archivo no coincide con el tipo declarado',
    );
  }
}
