import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { assertFileContentMatchesMimetype } from '../../../common/utils/file-signature.util';

export const UPLOADED_PDF_MIMETYPE = 'application/pdf';
const PDF_MAGIC = '%PDF-';
const MAX_BASE_NAME_LENGTH = 80;
const DEFAULT_BASE_NAME = 'informe-alta';

export interface ValidatedUploadedPdf {
  buffer: Buffer;
  // Nombre saneado: sin rutas ni caracteres de control, extensión .pdf.
  fileName: string;
  // SHA-256 en hex de los bytes recibidos.
  sha256: string;
}

// Deja un nombre de archivo seguro para guardar y para Content-Disposition: sin
// directorios, solo letras, números, espacios y . _ ( ) -, largo acotado y
// siempre con extensión .pdf (la original se descarta, no se confía en ella).
export function sanitizeUploadedFileName(original: string | undefined): string {
  const lastSegment = (original ?? '').split(/[\\/]/).pop() ?? '';
  const withoutExt = lastSegment.replace(/\.[^.]*$/, '');
  const cleaned = withoutExt
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/^[.\s_]+|[.\s]+$/g, '')
    .slice(0, MAX_BASE_NAME_LENGTH)
    .trim();
  return `${cleaned || DEFAULT_BASE_NAME}.pdf`;
}

// Valida el archivo subido como informe de alta propio. El PDF no se interpreta
// ni se renderiza en el servidor: solo se comprueba que sea un PDF por su
// declaración (mimetype exacto) y por su contenido (firma %PDF- al inicio, más
// la verificación de firmas común del proyecto), y se calcula su SHA-256.
export function validateUploadedPdf(
  file: Express.Multer.File | undefined,
): ValidatedUploadedPdf {
  if (!file) {
    throw new BadRequestException(
      'Debes adjuntar tu informe en PDF en el campo "file".',
    );
  }
  const buffer = file.buffer;
  if (!buffer || buffer.length === 0) {
    throw new BadRequestException('El archivo está vacío.');
  }
  if (file.mimetype !== UPLOADED_PDF_MIMETYPE) {
    throw new BadRequestException('Solo se permite subir un archivo PDF.');
  }
  if (buffer.subarray(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
    throw new BadRequestException('El archivo no es un PDF válido.');
  }
  assertFileContentMatchesMimetype(buffer, UPLOADED_PDF_MIMETYPE);

  return {
    buffer,
    fileName: sanitizeUploadedFileName(file.originalname),
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}
