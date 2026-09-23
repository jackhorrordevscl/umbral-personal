// Issue #159: consultReason/intervention/agreements ahora se persisten como
// HTML sanitizado (whitelist: p, br, strong, em, u, ul, ol, li -- sin
// atributos, ver clinical-note-sanitizer.util.ts). pdfkit no interpreta
// HTML, así que este util convierte ese HTML acotado a una lista de líneas
// con "runs" de texto con estilo (negrita/cursiva/subrayado) que
// renderClinicalNoteToPdf aplica con la API nativa de pdfkit
// (doc.font/doc.text con `continued: true` para encadenar runs en la misma
// línea). Deliberadamente NO es un parser HTML general -- solo entiende la
// whitelist exacta que el backend permite persistir, así que no hace falta
// traer una dependencia de parsing nueva para esto.

export interface ClinicalNoteTextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface ClinicalNoteLine {
  /** Viñeta o número de lista ("• ", "1. "), si la línea viene de un <li>. */
  bullet?: string;
  runs: ClinicalNoteTextRun[];
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(amp|lt|gt|quot|#39|apos|nbsp);/g,
    (_match, entity: string) => HTML_ENTITIES[entity] ?? _match,
  );
}

/**
 * Convierte el HTML sanitizado de una nota clínica en líneas con runs de
 * texto con estilo, listas para volcar directo a pdfkit. Texto plano sin
 * tags (datos históricos previos al editor rich-text) también funciona:
 * queda como una única línea con un solo run sin estilo.
 */
export function parseClinicalNoteHtml(html: string): ClinicalNoteLine[] {
  const lines: ClinicalNoteLine[] = [];
  let currentRuns: ClinicalNoteTextRun[] = [];
  let currentBullet: string | undefined;
  let boldDepth = 0;
  let italicDepth = 0;
  let underlineDepth = 0;
  let listType: 'ul' | 'ol' | null = null;
  let olCounter = 0;

  const pushLine = () => {
    if (currentRuns.length > 0 || currentBullet !== undefined) {
      lines.push({ bullet: currentBullet, runs: currentRuns });
    }
    currentRuns = [];
    currentBullet = undefined;
  };

  const tokens = (html ?? '').split(/(<[^>]+>)/g).filter((t) => t.length > 0);

  for (const token of tokens) {
    if (token.startsWith('<')) {
      const tagMatch = /^<\/?\s*([a-zA-Z0-9]+)/.exec(token);
      if (!tagMatch) continue;
      const tag = tagMatch[1].toLowerCase();
      const closing = token.startsWith('</');

      switch (tag) {
        case 'p':
          if (closing) pushLine();
          break;
        case 'br':
          pushLine();
          break;
        case 'strong':
          boldDepth = Math.max(0, boldDepth + (closing ? -1 : 1));
          break;
        case 'em':
          italicDepth = Math.max(0, italicDepth + (closing ? -1 : 1));
          break;
        case 'u':
          underlineDepth = Math.max(0, underlineDepth + (closing ? -1 : 1));
          break;
        case 'ul':
          listType = closing ? null : 'ul';
          break;
        case 'ol':
          if (closing) {
            listType = null;
          } else {
            listType = 'ol';
            olCounter = 0;
          }
          break;
        case 'li':
          if (closing) {
            pushLine();
          } else {
            pushLine();
            if (listType === 'ol') {
              olCounter += 1;
              currentBullet = `${olCounter}. `;
            } else {
              currentBullet = '• ';
            }
          }
          break;
        default:
          break;
      }
    } else {
      const text = decodeEntities(token);
      if (text.length === 0) continue;
      currentRuns.push({
        text,
        bold: boldDepth > 0,
        italic: italicDepth > 0,
        underline: underlineDepth > 0,
      });
    }
  }
  pushLine();

  return lines;
}

function fontFor(bold: boolean, italic: boolean): string {
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

/**
 * Renderiza una nota clínica (HTML sanitizado o texto plano heredado) en un
 * PDFDocument de pdfkit, preservando negrita/cursiva/subrayado/listas. Si el
 * contenido está vacío, no escribe nada (el llamador decide el placeholder,
 * ej. "Ninguno").
 */
export function renderClinicalNoteToPdf(
  doc: PDFKit.PDFDocument,
  html: string,
  options: { width: number; fontSize?: number },
): void {
  const lines = parseClinicalNoteHtml(html);
  const fontSize = options.fontSize ?? 10;

  if (lines.length === 0) return;

  for (const line of lines) {
    const writes: {
      text: string;
      bold: boolean;
      italic: boolean;
      underline: boolean;
    }[] = [];
    if (line.bullet) {
      writes.push({
        text: line.bullet,
        bold: false,
        italic: false,
        underline: false,
      });
    }
    if (line.runs.length === 0) {
      writes.push({ text: '', bold: false, italic: false, underline: false });
    } else {
      writes.push(...line.runs);
    }

    writes.forEach((run, index) => {
      const isLast = index === writes.length - 1;
      doc
        .font(fontFor(run.bold, run.italic))
        .fontSize(fontSize)
        .text(run.text, {
          continued: !isLast,
          underline: run.underline,
          width: options.width,
          align: 'justify',
        });
    });
  }
}
