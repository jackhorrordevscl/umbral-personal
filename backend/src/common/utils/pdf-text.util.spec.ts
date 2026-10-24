import { sanitizePdfText } from './pdf-text.util';

describe('sanitizePdfText', () => {
  it('conserva ASCII, Latin-1 y el bloque 0x80-0x9F de Windows-1252', () => {
    expect(sanitizePdfText('Año — “sesión” €5 ñ Ü')).toBe(
      'Año — “sesión” €5 ñ Ü',
    );
  });

  it('reemplaza por "?" símbolos, letras griegas y emojis', () => {
    expect(sanitizePdfText('A≥B ≤ → α 😀')).toBe('A?B ? ? ? ?');
  });

  it('omite controles y marcas invisibles en vez de reemplazarlos', () => {
    expect(sanitizePdfText('a​b‮c\u0007d')).toBe('abcd');
  });

  it('normaliza saltos de línea y tabuladores', () => {
    expect(sanitizePdfText('a\r\nb\tc')).toBe('a\nb c');
  });
});
