// pdfkit imprime texto plano (no interpreta formato), pero las fuentes
// estándar solo cubren WinAnsi: se descartan los caracteres de control y de
// dirección del texto, y lo que WinAnsi no representa se reemplaza por "?".
// Sin esto pdfkit dibuja otros glifos en silencio (por ejemplo "≥" sale como
// `"e`). Lo comparten el informe de alta y la ficha clínica.
// Puntos de código Unicode del bloque 0x80-0x9F de Windows-1252 (euro, comillas
// tipográficas, viñeta, guiones, etc.), escritos como números para no depender
// de caracteres especiales en el fuente.
const WINANSI_EXTRA_CODES = [
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
];
const WINANSI_EXTRA = new Set(
  WINANSI_EXTRA_CODES.map((code) => String.fromCodePoint(code)),
);

export function sanitizePdfText(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  let out = '';
  for (const ch of normalized) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\n') out += ch;
    else if (code >= 0x20 && code <= 0x7e) out += ch;
    else if (code >= 0xa0 && code <= 0xff) out += ch;
    else if (WINANSI_EXTRA.has(ch)) out += ch;
    // Resto (controles, bidi, ceros de ancho, emojis, otros alfabetos): "?".
    // Los controles y marcas invisibles se omiten en vez de reemplazarse.
    else if (isInvisible(code)) continue;
    else out += '?';
  }
  return out;
}

function isInvisible(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code < 0xa0) ||
    code === 0x00ad ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff ||
    (code >= 0xfe00 && code <= 0xfe0f)
  );
}
