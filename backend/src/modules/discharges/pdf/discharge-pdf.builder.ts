import PDFDocument from 'pdfkit';
import {
  CHILE_TIMEZONE,
  chileDayKeyFromInstant,
  dateOnlyDayKey,
} from '../../../common/utils/chile-time.util';

// Plantilla del PDF del informe de alta (T3). Función pura: recibe los datos
// ya resueltos y devuelve los bytes, sin acceso a base ni a storage, así se
// puede probar sin infraestructura.
//
// Minimización: el tipo de entrada NO incluye dropoutReason ni dropoutNote. El
// PDF puede llegar a un tercero (entrega con autorización) y el motivo de
// deserción es un dato interno del terapeuta; al no existir en la entrada, es
// imposible imprimirlo por accidente.

export interface DischargePdfDischarge {
  id: string;
  version: number;
  closureReason: string;
  referralDestination: string | null;
  admissionDate: Date;
  dischargeDate: Date;
  sessionCount: number;
  consultReason: string;
  diagnosis: string | null;
  evolutionSummary: string;
  statusAtDischarge: string;
  recommendations: string;
  // Snapshot del firmante tomado al emitir (no el User actual).
  signerName: string | null;
  signerRut: string | null;
  signerProfessionalRegistration: string | null;
  issuedAt: Date;
  contentHash: string;
}

export interface DischargePdfPatient {
  fullName: string;
  rut: string;
  birthDate: Date;
}

export interface DischargePdfGuardian {
  fullName: string;
  rut: string;
  relationship: string;
}

export interface DischargePdfInput {
  discharge: DischargePdfDischarge;
  patient: DischargePdfPatient;
  // Solo para un paciente con menos de 18 años al emitir; vacío en cualquier otro caso.
  guardians: DischargePdfGuardian[];
}

export interface DischargePdfOptions {
  // pdfkit comprime los streams por defecto; las pruebas lo desactivan para
  // poder leer el texto.
  compress?: boolean;
}

const CLOSURE_LABELS: Record<string, string> = {
  ACTIVE: 'En tratamiento',
  DISCHARGED: 'Alta',
  REFERRED: 'Derivado',
  DROPPED_OUT: 'Deserción',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  MOTHER: 'Madre',
  FATHER: 'Padre',
  LEGAL_GUARDIAN: 'Tutor legal',
  CURATOR: 'Curador',
  CAREGIVER: 'Cuidador',
  OTHER: 'Otro',
};

const MARGIN = 50;
// Reserva inferior para el pie, que se dibuja al final en todas las páginas.
const FOOTER_RESERVED = 118;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export function closureLabel(closureReason: string): string {
  return CLOSURE_LABELS[closureReason] ?? closureReason;
}

// pdfkit imprime texto plano (no interpreta formato), pero las fuentes
// estándar solo cubren WinAnsi: se descartan los caracteres de control y de
// dirección del texto, y lo que WinAnsi no representa se reemplaza por "?".
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

// "2026-03-02" -> "02-03-2026". Las fechas de calendario (ingreso, alta,
// nacimiento) se guardan como medianoche UTC: se leen en UTC, no en Santiago.
export function formatDayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split('-');
  return `${d}-${m}-${y}`;
}

export function formatCalendarDate(date: Date): string {
  return formatDayKey(dateOnlyDayKey(date));
}

// Instante emitido, en hora de Chile: "11-10-2026 15:04".
export function formatIssuedAt(instant: Date): string {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: CHILE_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
  return `${formatDayKey(chileDayKeyFromInstant(instant))} ${time}`;
}

export function buildDischargePdf(
  input: DischargePdfInput,
  options: DischargePdfOptions = {},
): Promise<Buffer> {
  const { discharge } = input;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: {
        top: MARGIN,
        bottom: FOOTER_RESERVED,
        left: MARGIN,
        right: MARGIN,
      },
      bufferPages: true,
      compress: options.compress ?? true,
      info: {
        Title: 'Informe de alta',
        Author: sanitizePdfText(discharge.signerName ?? ''),
        Creator: 'Umbral',
        // Fija la fecha de creación al instante de emisión: el contenido del
        // PDF depende solo del informe, no del momento en que se renderiza.
        CreationDate: discharge.issuedAt,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err: Error) => reject(err));

    try {
      renderBody(doc, input);
      renderFooters(doc, discharge);
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function renderBody(doc: PDFKit.PDFDocument, input: DischargePdfInput): void {
  const { discharge, patient, guardians } = input;
  const text = (value: string) => sanitizePdfText(value);

  const field = (label: string, value: string) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(`${label}: `, { continued: true })
      .font('Helvetica')
      .text(text(value));
  };

  const heading = (title: string) => {
    ensureSpace(doc, 60);
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(12).text(title);
    doc
      .moveTo(MARGIN, doc.y + 1)
      .lineTo(MARGIN + CONTENT_WIDTH, doc.y + 1)
      .stroke();
    doc.moveDown(0.5);
  };

  const block = (title: string, body: string) => {
    heading(title);
    doc.font('Helvetica').fontSize(10).text(text(body), { align: 'left' });
  };

  doc.font('Helvetica-Bold').fontSize(20).text('Informe de alta', {
    align: 'center',
  });
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(
      discharge.version > 1
        ? `Versión ${discharge.version}, reemplaza a la versión anterior`
        : `Versión ${discharge.version}`,
      { align: 'center' },
    );
  doc.moveDown(0.5);

  heading('Profesional que emite');
  field('Nombre', discharge.signerName ?? 'No registrado');
  if (discharge.signerRut) field('RUT', discharge.signerRut);
  if (discharge.signerProfessionalRegistration) {
    field('Registro profesional', discharge.signerProfessionalRegistration);
  }

  heading('Paciente');
  field('Nombre', patient.fullName);
  field('RUT', patient.rut);
  field('Fecha de nacimiento', formatCalendarDate(patient.birthDate));

  if (guardians.length > 0) {
    heading('Representante legal');
    guardians.forEach((guardian, index) => {
      if (index > 0) doc.moveDown(0.4);
      field('Nombre', guardian.fullName);
      field('RUT', guardian.rut);
      field(
        'Relación',
        RELATIONSHIP_LABELS[guardian.relationship] ?? guardian.relationship,
      );
    });
  }

  heading('Tratamiento');
  field('Fecha de ingreso', formatCalendarDate(discharge.admissionDate));
  field('Fecha de alta', formatCalendarDate(discharge.dischargeDate));
  field('Número de sesiones', String(discharge.sessionCount));
  field('Estado de cierre', closureLabel(discharge.closureReason));
  if (discharge.closureReason === 'REFERRED' && discharge.referralDestination) {
    field('Destino de derivación', discharge.referralDestination);
  }

  block('Motivo de consulta', discharge.consultReason);
  if (discharge.diagnosis && discharge.diagnosis.trim()) {
    block('Diagnóstico', discharge.diagnosis);
  }
  block('Evolución', discharge.evolutionSummary);
  block('Estado al alta', discharge.statusAtDischarge);
  block('Recomendaciones', discharge.recommendations);
}

// Si queda poco espacio útil antes del pie, abre una página nueva para que un
// título no quede huérfano al final de la anterior.
function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  const usableBottom = doc.page.height - FOOTER_RESERVED;
  if (doc.y + needed > usableBottom) doc.addPage();
}

// El pie se dibuja al final, ya con el total de páginas, en TODAS las páginas.
// Se pone el margen inferior en 0 solo mientras se escribe, para que pdfkit no
// abra una página nueva al escribir en la zona reservada.
function renderFooters(
  doc: PDFKit.PDFDocument,
  discharge: DischargePdfDischarge,
): void {
  const range = doc.bufferedPageRange();
  const signer = sanitizePdfText(discharge.signerName ?? 'el profesional');
  const lines: Array<{ font: string; size: number; value: string }> = [
    {
      font: 'Helvetica-Bold',
      size: 7.5,
      value: `Firma simple: documento emitido por ${signer} el ${formatIssuedAt(discharge.issuedAt)} (hora de Chile).`,
    },
    {
      font: 'Helvetica',
      size: 7.5,
      value: `Versión ${discharge.version}. ID del informe: ${discharge.id}`,
    },
    {
      font: 'Helvetica',
      size: 7.5,
      value: 'Hash de integridad SHA-256 del contenido del informe:',
    },
    { font: 'Courier', size: 7.5, value: discharge.contentHash },
    {
      font: 'Helvetica',
      size: 7,
      value:
        'Verificación: el terapeuta emisor puede comprobar que este informe no fue alterado desde su emisión, a partir del ID del informe y de la huella SHA-256 indicados arriba.',
    },
    {
      font: 'Helvetica',
      size: 7,
      value:
        'Ley 20.584: la ficha clínica es reservada y debe conservarse al menos 15 años. Este documento solo puede entregarse al paciente, a su representante legal o a un tercero con autorización.',
    },
  ];

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const previousBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    let y = doc.page.height - FOOTER_RESERVED + 8;
    doc
      .moveTo(MARGIN, y - 4)
      .lineTo(MARGIN + CONTENT_WIDTH, y - 4)
      .stroke();
    for (const line of lines) {
      doc.font(line.font).fontSize(line.size);
      doc.text(line.value, MARGIN, y, { width: CONTENT_WIDTH });
      y = doc.y + 1.5;
    }
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .text(`Página ${i - range.start + 1} de ${range.count}`, MARGIN, y, {
        width: CONTENT_WIDTH,
        align: 'right',
      });

    doc.page.margins.bottom = previousBottom;
  }
}
