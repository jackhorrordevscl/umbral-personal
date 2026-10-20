import {
  contentDispositionAttachment,
  sanitizeAttachmentFileName,
} from './attachment-file-name.util';

describe('sanitizeAttachmentFileName', () => {
  it('recupera las tildes que multer entrega como latin1', () => {
    const asMulterDelivers = Buffer.from('Informe sesión.pdf', 'utf8').toString(
      'latin1',
    );

    expect(sanitizeAttachmentFileName(asMulterDelivers)).toBe(
      'Informe sesión.pdf',
    );
  });

  it('deja intacto un nombre que ya viene en unicode', () => {
    expect(sanitizeAttachmentFileName('Ñandú – resumen.pdf')).toBe(
      'Ñandú _ resumen.pdf',
    );
  });

  it('conserva la extensión original en minúsculas', () => {
    expect(sanitizeAttachmentFileName('Radiografía.JPG')).toBe(
      'Radiografía.jpg',
    );
  });

  it('descarta directorios y reemplaza caracteres peligrosos', () => {
    expect(sanitizeAttachmentFileName('..\\..\\etc/pass"wd<x>.pdf')).toBe(
      'pass_wd_x_.pdf',
    );
  });

  it('acota el largo del nombre base a 80 caracteres', () => {
    const result = sanitizeAttachmentFileName(`${'a'.repeat(300)}.pdf`);

    expect(result).toBe(`${'a'.repeat(80)}.pdf`);
  });

  it('usa un nombre por defecto si no queda nada', () => {
    expect(sanitizeAttachmentFileName('...')).toBe('documento');
    expect(sanitizeAttachmentFileName(undefined)).toBe('documento');
  });

  it('no trata como extensión un sufijo largo o con caracteres raros', () => {
    expect(sanitizeAttachmentFileName('archivo.p d f')).toBe('archivo.p d f');
    expect(sanitizeAttachmentFileName('archivo.abcdefghijk')).toBe(
      'archivo.abcdefghijk',
    );
  });
});

describe('contentDispositionAttachment', () => {
  it('manda filename ASCII de respaldo y filename* en UTF-8', () => {
    expect(contentDispositionAttachment('Informe sesión.pdf')).toBe(
      `attachment; filename="Informe sesi_n.pdf"; filename*=UTF-8''Informe%20sesi%C3%B3n.pdf`,
    );
  });

  it('escapa los caracteres que RFC 5987 no permite sin codificar', () => {
    expect(contentDispositionAttachment("a'b(c)*.pdf")).toContain(
      "filename*=UTF-8''a%27b%28c%29%2A.pdf",
    );
  });

  it('no deja comillas, barras ni % sin neutralizar en el filename ASCII', () => {
    expect(contentDispositionAttachment('a"b\\c%d.pdf')).toContain(
      'filename="a_b_c_d.pdf"',
    );
  });
});
