import { BadRequestException } from '@nestjs/common';

// El `mimetype` declarado por el cliente en el upload multipart es un header
// controlado por el atacante y trivialmente falseable (issue #51). Esta
// utilidad valida el contenido real del archivo vía magic bytes y lo compara
// contra el mimetype declarado, en vez de confiar ciegamente en él.
//
// Se implementa a mano (sin `file-type` u otra librería de detección
// genérica) por dos motivos: (1) `file-type` >=17 es ESM-only y rompe bajo
// Jest/ts-jest sin flags especiales; (2) la última versión CJS (16.5.4)
// tiene un DoS conocido (loop infinito parseando ASF malformado, GHSA-5v7r-
// 6r5c-r473) sin fix disponible en ninguna versión CJS. Como el allowlist de
// tipos permitidos es fijo y chico (8 formatos), comparar prefijos de magic
// bytes a mano cubre el caso real sin la superficie de un parser genérico de
// terceros que interpreta decenas de formatos que nunca vamos a aceptar.
//
// No distingue variantes viejas de Office (.doc/.xls/.ppt): todas comparten
// el contenedor "Compound File Binary" y no hay forma de diferenciarlas solo
// por los primeros bytes. Tampoco distingue OOXML moderno (.docx/.xlsx/.pptx)
// de un ZIP genérico sin parsear el índice interno del ZIP -- ambas
// limitaciones ya existían con `file-type` (issue #51 original), no son
// una regresión de este reemplazo.
interface Signature {
  mimetypes: string[];
  matches: (buffer: Buffer) => boolean;
}

const SIGNATURES: Signature[] = [
  {
    mimetypes: ['application/pdf'],
    matches: (b) => hasPrefix(b, [0x25, 0x50, 0x44, 0x46, 0x2d]), // %PDF-
  },
  {
    mimetypes: ['image/jpeg'],
    matches: (b) => hasPrefix(b, [0xff, 0xd8, 0xff]),
  },
  {
    mimetypes: ['image/png'],
    matches: (b) =>
      hasPrefix(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    mimetypes: ['image/gif'],
    matches: (b) =>
      hasPrefix(b, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || // GIF87a
      hasPrefix(b, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), // GIF89a
  },
  {
    mimetypes: ['image/webp'],
    matches: (b) =>
      b.length >= 12 &&
      hasPrefix(b, [0x52, 0x49, 0x46, 0x46]) && // RIFF
      b.subarray(8, 12).equals(Buffer.from('WEBP', 'ascii')),
  },
  {
    // Contenedor Compound File Binary: .doc/.xls/.ppt viejos comparten esta
    // firma, no se puede distinguir cuál es sin parsear el stream interno.
    mimetypes: [
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
    ],
    matches: (b) =>
      hasPrefix(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  },
  {
    // ZIP y los formatos OOXML modernos (que son ZIP por dentro) comparten
    // esta firma.
    mimetypes: [
      'application/zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    matches: (b) => hasPrefix(b, [0x50, 0x4b, 0x03, 0x04]),
  },
];

function hasPrefix(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) return false;
  }
  return true;
}

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
export function assertFileContentMatchesMimetype(
  buffer: Buffer,
  declaredMimetype: string,
): void {
  const signature = SIGNATURES.find((sig) => sig.matches(buffer));

  if (!signature) {
    if (declaredMimetype === 'text/plain' && looksLikePlainText(buffer)) {
      return;
    }
    throw new BadRequestException(
      'El contenido del archivo no coincide con el tipo declarado',
    );
  }

  if (!signature.mimetypes.includes(declaredMimetype)) {
    throw new BadRequestException(
      'El contenido del archivo no coincide con el tipo declarado',
    );
  }
}
