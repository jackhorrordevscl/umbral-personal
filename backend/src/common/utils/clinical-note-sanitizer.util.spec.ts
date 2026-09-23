import { sanitizeClinicalNote } from './clinical-note-sanitizer.util';

describe('sanitizeClinicalNote', () => {
  it('permite el formato básico que produce el editor (bold/italic/underline/listas/párrafos)', () => {
    const input =
      '<p>Paciente reporta <strong>ansiedad</strong> y <em>insomnio</em>.</p>' +
      '<ul><li>Tarea 1</li><li>Tarea 2</li></ul><p><u>Subrayado</u></p><br>';

    expect(sanitizeClinicalNote(input)).toBe(
      input.replace('<br>', '<br />'),
    );
  });

  it('elimina tags de script y su contenido', () => {
    const result = sanitizeClinicalNote(
      '<p>Nota</p><script>alert("xss")</script>',
    );

    expect(result).toBe('<p>Nota</p>');
    expect(result).not.toContain('script');
  });

  it('elimina atributos peligrosos como onerror y href javascript:', () => {
    const result = sanitizeClinicalNote(
      '<p onclick="alert(1)">Nota</p><img src=x onerror="alert(1)">' +
        '<a href="javascript:alert(1)">link</a>',
    );

    expect(result).toBe('<p>Nota</p>link');
  });

  it('descarta tags no permitidos (ej. iframe, style) preservando el texto', () => {
    const result = sanitizeClinicalNote(
      '<p>Texto</p><iframe src="evil.com"></iframe><style>body{}</style>',
    );

    expect(result).toBe('<p>Texto</p>');
  });

  it('preserva null y undefined tal cual (campo opcional)', () => {
    expect(sanitizeClinicalNote(null)).toBeNull();
    expect(sanitizeClinicalNote(undefined)).toBeUndefined();
  });

  it('acepta texto plano sin HTML sin modificarlo', () => {
    expect(sanitizeClinicalNote('Texto plano sin formato')).toBe(
      'Texto plano sin formato',
    );
  });
});
