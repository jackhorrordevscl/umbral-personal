import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  sanitizeUploadedFileName,
  validateUploadedPdf,
} from './uploaded-pdf.util';

function pdfBuffer(extra = ''): Buffer {
  return Buffer.from(`%PDF-1.4\n${extra}\n%%EOF`, 'latin1');
}

function file(overrides: Partial<Express.Multer.File> = {}) {
  const buffer = overrides.buffer ?? pdfBuffer('contenido');
  return {
    originalname: 'epicrisis.pdf',
    mimetype: 'application/pdf',
    size: buffer.length,
    buffer,
    ...overrides,
  } as Express.Multer.File;
}

describe('validateUploadedPdf', () => {
  it('acepta un PDF válido y devuelve nombre saneado y SHA-256 de los bytes', () => {
    const f = file();
    const result = validateUploadedPdf(f);
    expect(result.buffer).toBe(f.buffer);
    expect(result.fileName).toBe('epicrisis.pdf');
    expect(result.sha256).toBe(
      createHash('sha256').update(f.buffer).digest('hex'),
    );
  });

  it('rechaza la ausencia de archivo con 400', () => {
    expect(() => validateUploadedPdf(undefined)).toThrow(BadRequestException);
  });

  it('rechaza un archivo vacío', () => {
    expect(() =>
      validateUploadedPdf(file({ buffer: Buffer.alloc(0) })),
    ).toThrow(BadRequestException);
  });

  it('rechaza un mimetype distinto de application/pdf aunque los bytes sean PDF', () => {
    expect(() =>
      validateUploadedPdf(file({ mimetype: 'application/octet-stream' })),
    ).toThrow(BadRequestException);
    expect(() => validateUploadedPdf(file({ mimetype: 'image/png' }))).toThrow(
      BadRequestException,
    );
  });

  it('rechaza un ejecutable declarado como PDF (mime falso)', () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(() => validateUploadedPdf(file({ buffer: exe }))).toThrow(
      BadRequestException,
    );
  });

  it('rechaza un PNG renombrado a .pdf', () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    expect(() =>
      validateUploadedPdf(file({ buffer: png, originalname: 'a.pdf' })),
    ).toThrow(BadRequestException);
  });

  it('rechaza texto plano sin la firma %PDF- al inicio', () => {
    expect(() =>
      validateUploadedPdf(file({ buffer: Buffer.from('hola mundo') })),
    ).toThrow(BadRequestException);
  });

  it('rechaza una firma %PDF- que no está al inicio del archivo', () => {
    expect(() =>
      validateUploadedPdf(file({ buffer: Buffer.from('xx%PDF-1.4\n%%EOF') })),
    ).toThrow(BadRequestException);
  });
});

describe('sanitizeUploadedFileName', () => {
  it('quita rutas, caracteres de control y comillas', () => {
    expect(
      sanitizeUploadedFileName(String.raw`..\..\windows\system32\a.pdf`),
    ).toBe('a.pdf');
    expect(sanitizeUploadedFileName('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(sanitizeUploadedFileName('inf"orme\r\nX-Evil: 1.pdf')).not.toMatch(
      /["\r\n]/,
    );
  });

  it('fuerza la extensión .pdf aunque venga otra', () => {
    expect(sanitizeUploadedFileName('informe.exe')).toBe('informe.pdf');
    expect(sanitizeUploadedFileName('informe')).toBe('informe.pdf');
  });

  it('acota el largo y usa un nombre por defecto si queda vacío', () => {
    const long = `${'a'.repeat(300)}.pdf`;
    expect(sanitizeUploadedFileName(long).length).toBeLessThanOrEqual(84);
    expect(sanitizeUploadedFileName('')).toBe('informe-alta.pdf');
    expect(sanitizeUploadedFileName('///')).toBe('informe-alta.pdf');
    expect(sanitizeUploadedFileName('...pdf')).toBe('informe-alta.pdf');
  });

  it('conserva letras con tilde y espacios', () => {
    expect(sanitizeUploadedFileName('Epicrisis Ñuñoa 2026.pdf')).toBe(
      'Epicrisis Ñuñoa 2026.pdf',
    );
  });
});
