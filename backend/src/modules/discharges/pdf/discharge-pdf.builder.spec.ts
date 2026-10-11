import {
  buildDischargePdf,
  closureLabel,
  formatIssuedAt,
  sanitizePdfText,
  type DischargePdfInput,
} from './discharge-pdf.builder';

const HASH = 'a'.repeat(16) + 'b'.repeat(16) + 'c'.repeat(16) + 'd'.repeat(16);

function baseInput(
  overrides: Partial<DischargePdfInput['discharge']> = {},
  extra: Partial<DischargePdfInput> = {},
): DischargePdfInput {
  return {
    discharge: {
      id: 'dis-0001',
      version: 1,
      closureReason: 'DISCHARGED',
      referralDestination: null,
      admissionDate: new Date('2026-03-02T00:00:00.000Z'),
      dischargeDate: new Date('2026-09-30T00:00:00.000Z'),
      sessionCount: 12,
      consultReason: 'Ansiedad generalizada',
      diagnosis: null,
      evolutionSummary: 'Evolución favorable durante el proceso',
      statusAtDischarge: 'Estable, sin síntomas relevantes',
      recommendations: 'Control a los tres meses',
      signerName: 'Ana Pérez',
      signerRut: '12.345.678-5',
      signerProfessionalRegistration: 'Reg. 4521',
      // 11 oct 2026 18:04 UTC = 15:04 en Chile (UTC-3 en octubre).
      issuedAt: new Date('2026-10-11T18:04:00.000Z'),
      contentHash: HASH,
      ...overrides,
    },
    patient: {
      fullName: 'Luis Soto Rojas',
      rut: '9.876.543-3',
      birthDate: new Date('1990-05-20T00:00:00.000Z'),
    },
    guardians: [],
    ...extra,
  };
}

// Con compress: false los streams de contenido quedan legibles. pdfkit codifica
// el texto de las fuentes estándar como cadenas hexadecimales WinAnsi (latin1)
// dentro de operadores TJ.
function pageStreams(pdf: Buffer): string[] {
  const raw = pdf.toString('latin1');
  const streams: string[] = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) streams.push(match[1]);
  return streams.filter((s) => s.includes(' TJ'));
}

function decodeStream(stream: string): string[] {
  const lines: string[] = [];
  const re = /\[((?:<[0-9a-fA-F]*>|\s|-?[\d.]+)*)\]\s*TJ/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stream)) !== null) {
    const parts = [...match[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((m) =>
      Buffer.from(m[1], 'hex').toString('latin1'),
    );
    lines.push(parts.join(''));
  }
  return lines;
}

function allText(pdf: Buffer): string {
  return pageStreams(pdf)
    .flatMap((s) => decodeStream(s))
    .join('\n');
}

describe('buildDischargePdf', () => {
  it('devuelve bytes que empiezan con %PDF-', async () => {
    const pdf = await buildDischargePdf(baseInput());
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('con compresión por defecto también es un PDF válido', async () => {
    const pdf = await buildDischargePdf(baseInput(), {});
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('imprime el encabezado, el firmante, el paciente y las fechas', async () => {
    const text = allText(
      await buildDischargePdf(baseInput(), { compress: false }),
    );
    expect(text).toContain('Informe de alta');
    expect(text).toContain('Ana Pérez');
    expect(text).toContain('12.345.678-5');
    expect(text).toContain('Reg. 4521');
    expect(text).toContain('Luis Soto Rojas');
    expect(text).toContain('9.876.543-3');
    expect(text).toContain('20-05-1990');
    expect(text).toContain('02-03-2026');
    expect(text).toContain('30-09-2026');
    expect(text).toContain('12');
    expect(text).toContain('Ansiedad generalizada');
    expect(text).toContain('Evolución favorable durante el proceso');
    expect(text).toContain('Control a los tres meses');
  });

  it('usa el snapshot del firmante, y omite RUT o registro si no existen', async () => {
    const text = allText(
      await buildDischargePdf(
        baseInput({
          signerRut: null,
          signerProfessionalRegistration: null,
        }),
        { compress: false },
      ),
    );
    expect(text).toContain('Ana Pérez');
    expect(text).not.toContain('Registro profesional');
    expect(text).not.toContain('12.345.678-5');
  });

  it.each([
    ['DISCHARGED', 'Alta'],
    ['REFERRED', 'Derivado'],
    ['DROPPED_OUT', 'Deserción'],
    ['ACTIVE', 'En tratamiento'],
  ])('etiqueta %s como %s', async (reason, label) => {
    expect(closureLabel(reason)).toBe(label);
    const text = allText(
      await buildDischargePdf(baseInput({ closureReason: reason }), {
        compress: false,
      }),
    );
    expect(text).toContain(label);
  });

  it('muestra el diagnóstico solo si existe', async () => {
    const without = allText(
      await buildDischargePdf(baseInput(), { compress: false }),
    );
    expect(without).not.toContain('Diagnóstico');
    const withDx = allText(
      await buildDischargePdf(baseInput({ diagnosis: 'F41.1 TAG' }), {
        compress: false,
      }),
    );
    expect(withDx).toContain('Diagnóstico');
    expect(withDx).toContain('F41.1 TAG');
  });

  it('muestra el destino de derivación solo con REFERRED', async () => {
    const referred = allText(
      await buildDischargePdf(
        baseInput({
          closureReason: 'REFERRED',
          referralDestination: 'Psiquiatría CESFAM Norte',
        }),
        { compress: false },
      ),
    );
    expect(referred).toContain('Psiquiatría CESFAM Norte');
    const discharged = allText(
      await buildDischargePdf(
        baseInput({ referralDestination: 'Psiquiatría CESFAM Norte' }),
        { compress: false },
      ),
    );
    expect(discharged).not.toContain('Psiquiatría CESFAM Norte');
  });

  it('NO imprime dropoutReason ni dropoutNote aunque lleguen en el objeto', async () => {
    const leaky = {
      ...baseInput({ closureReason: 'DROPPED_OUT' }).discharge,
      dropoutReason: 'COST',
      dropoutNote: 'NOTA-LIBRE-PRIVADA',
    };
    const pdf = await buildDischargePdf(
      { ...baseInput(), discharge: leaky },
      { compress: false },
    );
    const text = allText(pdf);
    const raw = pdf.toString('latin1');
    expect(text).toContain('Deserción');
    expect(text).not.toContain('NOTA-LIBRE-PRIVADA');
    expect(text).not.toContain('COST');
    expect(raw).not.toContain('NOTA-LIBRE-PRIVADA');
  });

  it('un informe corregido indica versión y que reemplaza a la anterior', async () => {
    const v2 = allText(
      await buildDischargePdf(baseInput({ version: 2 }), { compress: false }),
    );
    expect(v2).toContain('Versión 2, reemplaza a la versión anterior');
    const v1 = allText(
      await buildDischargePdf(baseInput(), { compress: false }),
    );
    expect(v1).not.toContain('reemplaza');
  });

  describe('representante legal', () => {
    const guardian = {
      fullName: 'María Rojas Díaz',
      rut: '7.654.321-6',
      relationship: 'MOTHER',
    };

    it('lo incluye cuando se le pasan representantes', async () => {
      const text = allText(
        await buildDischargePdf(baseInput({}, { guardians: [guardian] }), {
          compress: false,
        }),
      );
      expect(text).toContain('Representante legal');
      expect(text).toContain('María Rojas Díaz');
      expect(text).toContain('7.654.321-6');
      expect(text).toContain('Madre');
    });

    it('sin representantes omite la sección', async () => {
      const text = allText(
        await buildDischargePdf(baseInput(), { compress: false }),
      );
      expect(text).not.toContain('Representante legal');
    });
  });

  describe('pie de página', () => {
    const longText = Array.from(
      { length: 160 },
      (_, i) => `Línea ${i + 1} de la evolución del proceso terapéutico.`,
    ).join('\n');

    it('aparece en TODAS las páginas con firma, versión, ID y hash completo', async () => {
      const pdf = await buildDischargePdf(
        baseInput({ evolutionSummary: longText }),
        { compress: false },
      );
      const streams = pageStreams(pdf);
      expect(streams.length).toBeGreaterThan(1);
      for (const stream of streams) {
        const lines = decodeStream(stream);
        const text = lines.join('\n');
        expect(lines).toContain(HASH);
        expect(text).toContain(
          'Firma simple: documento emitido por Ana Pérez el 11-10-2026 15:04',
        );
        expect(text).toContain('ID del informe: dis-0001');
        expect(text).toContain('/api/v1/discharges/dis-0001/verify');
        expect(text).toContain('Ley 20.584');
      }
    });

    it('numera las páginas', async () => {
      const pdf = await buildDischargePdf(
        baseInput({ evolutionSummary: longText }),
        { compress: false },
      );
      const total = pageStreams(pdf).length;
      const text = allText(pdf);
      expect(text).toContain(`Página 1 de ${total}`);
      expect(text).toContain(`Página ${total} de ${total}`);
    });

    it('el texto largo continúa en otra página sin perder líneas', async () => {
      const text = allText(
        await buildDischargePdf(baseInput({ evolutionSummary: longText }), {
          compress: false,
        }),
      );
      expect(text).toContain('Línea 1 de la evolución');
      expect(text).toContain('Línea 160 de la evolución');
    });

    it('no abre páginas de más para un informe corto', async () => {
      const pdf = await buildDischargePdf(baseInput(), { compress: false });
      expect(pageStreams(pdf)).toHaveLength(1);
    });
  });

  describe('texto no confiable', () => {
    it('los caracteres de control y de dirección no rompen el PDF', async () => {
      const hostile =
        'Hola\u0000\u0007\u001b[31m‮oculto​⁦fin\r\nOtra línea 😀 ñ';
      const pdf = await buildDischargePdf(
        baseInput({ consultReason: hostile }),
        { compress: false },
      );
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      const text = allText(pdf);
      expect(text).toContain('Otra línea ? ñ');
      expect(pdf.includes(0x07)).toBe(false);
    });

    it('sanitizePdfText quita controles y reemplaza lo no representable', () => {
      expect(sanitizePdfText('a\u0000b\tc\r\nd')).toBe('ab c\nd');
      expect(sanitizePdfText('x‮y')).toBe('xy');
      expect(sanitizePdfText('日本')).toBe('??');
      expect(sanitizePdfText('Año “ok” – €')).toBe('Año “ok” – €');
    });

    it('el formato tipo markdown o PDF se imprime tal cual, sin interpretarse', async () => {
      const text = allText(
        await buildDischargePdf(
          baseInput({ consultReason: '(**negrita**) /Type /Page BT ET' }),
          { compress: false },
        ),
      );
      expect(text).toContain('(**negrita**) /Type /Page BT ET');
    });
  });

  it('formatIssuedAt usa la hora de Chile', () => {
    // Enero es horario de verano (UTC-3); julio, de invierno (UTC-4).
    expect(formatIssuedAt(new Date('2026-01-15T15:00:00.000Z'))).toBe(
      '15-01-2026 12:00',
    );
    expect(formatIssuedAt(new Date('2026-07-15T15:00:00.000Z'))).toBe(
      '15-07-2026 11:00',
    );
    // Cerca de la medianoche cambia el día calendario de Chile.
    expect(formatIssuedAt(new Date('2026-10-12T02:30:00.000Z'))).toBe(
      '11-10-2026 23:30',
    );
  });
});
