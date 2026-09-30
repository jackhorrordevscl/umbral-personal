import { escapeHtml } from './escape-html.util';

describe('escapeHtml', () => {
  it('escapa &, <, >, comillas dobles y simples', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('escapa & primero para no doble-escapar sus propias entidades', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('deja intactos nombres con tildes, ñ y espacios', () => {
    expect(escapeHtml('José Núñez')).toBe('José Núñez');
  });

  it('devuelve string vacío para string vacío', () => {
    expect(escapeHtml('')).toBe('');
  });
});
