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

    it('texto plano heredado con "<" o ">" sueltos conserva el texto en vez de tratarlo como tag (issue #288)', () => {
      const lines = parseClinicalNoteHtml('PHQ-9 < 10 y GAD-7 > 5, a<b');

      expect(lines).toHaveLength(1);
      expect(lines[0].runs.map((r) => r.text).join('')).toBe(
        'PHQ-9 < 10 y GAD-7 > 5, a<b',
      );
    });

    // Issue #504: texto heredado con forma de etiqueta (no está en la whitelist
    // del editor) es contenido clínico, no markup: no puede desaparecer.
    it('texto heredado con forma de etiqueta desconocida ("<paciente llora>", "<mg>") se conserva como texto', () => {
      const lines = parseClinicalNoteHtml(
        'Refiere <paciente llora> y toma 20 <mg> al día</mg>',
      );

      expect(lines).toHaveLength(1);
      expect(lines[0].runs.map((r) => r.text).join('')).toBe(
        'Refiere <paciente llora> y toma 20 <mg> al día</mg>',
      );
    });

    it('una etiqueta desconocida dentro de HTML real se conserva y los tags de la whitelist siguen aplicando', () => {
      const lines = parseClinicalNoteHtml(
        '<p>Sesión <strong>difícil</strong>: <llanto></p>',
      );

      expect(lines).toHaveLength(1);
      expect(lines[0].runs.map((r) => r.text)).toEqual([
        'Sesión ',
        'difícil',
        ': ',
        '<llanto>',
      ]);
      expect(lines[0].runs[1].bold).toBe(true);
      expect(lines[0].runs[3].bold).toBe(false);
    });

    it('HTML real con entidades escapadas sigue decodificándose y respeta los tags', () => {
      const lines = parseClinicalNoteHtml(
        '<p>Puntaje &lt; 10 con <strong>mejora</strong></p>',
      );

      expect(lines).toHaveLength(1);
      expect(lines[0].runs.map((r) => r.text)).toEqual([
        'Puntaje < 10 con ',
        'mejora',
      ]);
      expect(lines[0].runs[1].bold).toBe(true);
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

    it('lista ordenada anidada conserva la numeración del nivel exterior y marca la sangría (issue #504)', () => {
      const lines = parseClinicalNoteHtml(
        '<ol><li><p>a</p><ol><li><p>b</p></li></ol></li><li><p>c</p></li></ol>',
      );

      expect(lines.map((l) => l.bullet)).toEqual(['1. ', '1. ', '2. ']);
      expect(lines.map((l) => l.runs[0].text)).toEqual(['a', 'b', 'c']);
      expect(lines.map((l) => l.depth)).toEqual([0, 1, 0]);
    });

    it('viñetas dentro de una lista ordenada (y al revés) no mezclan el tipo ni el contador', () => {
      const lines = parseClinicalNoteHtml(
        '<ol><li>uno<ul><li>x</li><li>y</li></ul></li><li>dos<ol><li>p</li></ol></li><li>tres</li></ol>',
      );

      expect(lines.map((l) => l.bullet)).toEqual([
        '1. ',
        '• ',
        '• ',
        '2. ',
        '1. ',
        '3. ',
      ]);
      expect(lines.map((l) => l.depth)).toEqual([0, 1, 1, 0, 1, 0]);
    });

    it('un <ol> anidado reiniciado no pisa el contador del exterior al cerrarse', () => {
      const lines = parseClinicalNoteHtml(
        '<ol><li>a<ol><li>b</li><li>c</li></ol></li><li>d<ol><li>e</li></ol></li></ol>',
      );

      expect(lines.map((l) => l.bullet)).toEqual([
        '1. ',
        '1. ',
        '2. ',
        '2. ',
        '1. ',
      ]);
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

    it('sangra la viñeta de los items de listas anidadas (issue #504)', () => {
      const { doc, calls } = buildFakeDoc();
      renderClinicalNoteToPdf(
        doc,
        '<ul><li>Uno<ul><li>Sub</li></ul></li></ul>',
        { width: 500 },
      );

      const texts = calls
        .filter((c) => c.method === 'text')
        .map((c) => c.args[0]);
      expect(texts).toEqual(['• ', 'Uno', '    • ', 'Sub']);
    });

    it('reemplaza por "?" lo que WinAnsi no representa (issue #504)', () => {
      const { doc, calls } = buildFakeDoc();
      renderClinicalNoteToPdf(doc, '<p>PHQ ≥ 10 → derivar 😀</p>', {
        width: 500,
      });

      const texts = calls
        .filter((c) => c.method === 'text')
        .map((c) => c.args[0]);
      expect(texts).toEqual(['PHQ ? 10 ? derivar ?']);
    });

    it('conserva tildes, ñ y signos tipográficos de WinAnsi', () => {
      const { doc, calls } = buildFakeDoc();
      renderClinicalNoteToPdf(doc, '<p>Año — “sesión” €5</p>', { width: 500 });

      const texts = calls
        .filter((c) => c.method === 'text')
        .map((c) => c.args[0]);
      expect(texts).toEqual(['Año — “sesión” €5']);
    });
  });
});
