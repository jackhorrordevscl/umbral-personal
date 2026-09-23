import {
  parseClinicalNoteHtml,
  renderClinicalNoteToPdf,
} from './clinical-note-pdf.util';

describe('clinical-note-pdf.util', () => {
  describe('parseClinicalNoteHtml', () => {
    it('texto plano heredado (sin tags) queda como una sola línea sin estilo', () => {
      const lines = parseClinicalNoteHtml('Motivo de consulta plano');

      expect(lines).toEqual([
        {
          bullet: undefined,
          runs: [
            {
              text: 'Motivo de consulta plano',
              bold: false,
              italic: false,
              underline: false,
            },
          ],
        },
      ]);
    });

    it('separa párrafos en líneas distintas', () => {
      const lines = parseClinicalNoteHtml('<p>Primero</p><p>Segundo</p>');

      expect(lines).toHaveLength(2);
      expect(lines[0].runs[0].text).toBe('Primero');
      expect(lines[1].runs[0].text).toBe('Segundo');
    });

    it('reconoce negrita/cursiva/subrayado combinados', () => {
      const lines = parseClinicalNoteHtml(
        '<p>normal <strong>negrita <em>negrita+cursiva</em></strong> <u>subrayado</u></p>',
      );

      expect(lines).toHaveLength(1);
      const runs = lines[0].runs;
      expect(runs).toEqual([
        { text: 'normal ', bold: false, italic: false, underline: false },
        { text: 'negrita ', bold: true, italic: false, underline: false },
        {
          text: 'negrita+cursiva',
          bold: true,
          italic: true,
          underline: false,
        },
        { text: ' ', bold: false, italic: false, underline: false },
        { text: 'subrayado', bold: false, italic: false, underline: true },
      ]);
    });

    it('numera listas ordenadas y usa viñeta en listas sin orden', () => {
      const bulleted = parseClinicalNoteHtml(
        '<ul><li>Uno</li><li>Dos</li></ul>',
      );
      expect(bulleted.map((l) => l.bullet)).toEqual(['• ', '• ']);

      const numbered = parseClinicalNoteHtml(
        '<ol><li>Uno</li><li>Dos</li></ol>',
      );
      expect(numbered.map((l) => l.bullet)).toEqual(['1. ', '2. ']);
    });

    it('decodifica entidades HTML básicas', () => {
      const lines = parseClinicalNoteHtml(
        '<p>A &amp; B &lt;test&gt; &quot;cita&quot;</p>',
      );

      expect(lines[0].runs[0].text).toBe('A & B <test> "cita"');
    });

    it('<br> corta la línea sin cerrar el párrafo', () => {
      const lines = parseClinicalNoteHtml('<p>Uno<br>Dos</p>');

      expect(lines).toHaveLength(2);
      expect(lines[0].runs[0].text).toBe('Uno');
      expect(lines[1].runs[0].text).toBe('Dos');
    });

    it('string vacío no produce líneas', () => {
      expect(parseClinicalNoteHtml('')).toEqual([]);
    });
  });

  describe('renderClinicalNoteToPdf', () => {
    function buildFakeDoc() {
      const calls: { method: string; args: unknown[] }[] = [];
      const doc: Record<string, unknown> = {};
      doc.font = (...args: unknown[]) => {
        calls.push({ method: 'font', args });
        return doc;
      };
      doc.fontSize = (...args: unknown[]) => {
        calls.push({ method: 'fontSize', args });
        return doc;
      };
      doc.text = (...args: unknown[]) => {
        calls.push({ method: 'text', args });
        return doc;
      };
      return { doc: doc as unknown as PDFKit.PDFDocument, calls };
    }

    it('no escribe nada para contenido vacío', () => {
      const { doc, calls } = buildFakeDoc();
      renderClinicalNoteToPdf(doc, '', { width: 500 });
      expect(calls).toHaveLength(0);
    });

    it('aplica Helvetica-Bold en runs en negrita y Helvetica en runs normales', () => {
      const { doc, calls } = buildFakeDoc();
      renderClinicalNoteToPdf(doc, '<p>normal <strong>negrita</strong></p>', {
        width: 500,
      });

      const fontCalls = calls
        .filter((c) => c.method === 'font')
        .map((c) => c.args[0]);
      expect(fontCalls).toEqual(['Helvetica', 'Helvetica-Bold']);

      const textCalls = calls.filter((c) => c.method === 'text');
      expect(textCalls[0].args[0]).toBe('normal ');
      expect((textCalls[0].args[1] as { continued: boolean }).continued).toBe(
        true,
      );
      expect(textCalls[1].args[0]).toBe('negrita');
      expect((textCalls[1].args[1] as { continued: boolean }).continued).toBe(
        false,
      );
    });

    it('antepone la viñeta como un run propio en items de lista', () => {
      const { doc, calls } = buildFakeDoc();
      renderClinicalNoteToPdf(doc, '<ul><li>Tarea</li></ul>', { width: 500 });

      const textCalls = calls.filter((c) => c.method === 'text');
      expect(textCalls[0].args[0]).toBe('• ');
      expect(textCalls[1].args[0]).toBe('Tarea');
    });
  });
});
