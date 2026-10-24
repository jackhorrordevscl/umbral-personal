import { buildTestClinicalCrypto } from '../../common/crypto/clinical-text-crypto.testing';
import { NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { ReportsService } from './reports.service';
import * as clinicalNotePdf from './clinical-note-pdf.util';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';

function buildPatientWithConsultations() {
  return {
    id: 'patient-1',
    fullName: 'Paciente de Prueba',
    rut: '11111111-1',
    birthDate: new Date('1990-01-01'),
    occupation: null,
    address: null,
    phone: null,
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    treatingPsychiatrist: null,
    treatingDoctor: null,
    therapist: { name: 'Dra. Terapeuta', email: 'terapeuta@umbral.cl' },
    consultations: [
      {
        sessionDate: new Date('2026-01-10T12:00:00'),
        sessionType: 'IN_PERSON',
        consultReason: 'Motivo de consulta',
        intervention: 'Intervención realizada',
        agreements: null as string | null,
        nextSessionDate: null as Date | null,
      },
    ],
  };
}

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: { patient: { findFirst: jest.Mock } };
  let patientsService: {
    assertAccess: jest.Mock;
    getConsentStatusMap: jest.Mock;
  };

  beforeEach(() => {
    prisma = { patient: { findFirst: jest.fn() } };
    patientsService = {
      assertAccess: jest
        .fn()
        .mockResolvedValue({ id: 'patient-1', rut: '11111111-1' }),
      getConsentStatusMap: jest
        .fn()
        .mockResolvedValue(
          new Map([['patient-1', { TREATMENT: true, TELEMEDICINE: false }]]),
        ),
    };

    service = new ReportsService(
      prisma as unknown as PrismaService,
      patientsService as unknown as PatientsService,
      buildTestClinicalCrypto(),
    );
  });

  it('valida acceso al paciente antes de generar el PDF', async () => {
    patientsService.assertAccess.mockRejectedValue(
      new NotFoundException('Paciente no encontrado'),
    );

    await expect(
      service.generatePatientReport('patient-1', 'therapist-1'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.patient.findFirst).not.toHaveBeenCalled();
  });

  it('lanza 404 si el paciente no existe', async () => {
    prisma.patient.findFirst.mockResolvedValue(null);

    await expect(
      service.generatePatientReport('patient-1', 'therapist-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('valida acceso con el id del paciente y el del usuario, y repite ambos filtros al leer la ficha (defensa en profundidad)', async () => {
    prisma.patient.findFirst.mockResolvedValue(buildPatientWithConsultations());

    await service.generatePatientReport('patient-1', 'therapist-1');

    expect(patientsService.assertAccess).toHaveBeenCalledWith(
      'patient-1',
      'therapist-1',
    );
    const args = prisma.patient.findFirst.mock.calls[0] as [
      { where: unknown; include: { therapist: { select: unknown } } },
    ];
    expect(args[0].where).toEqual({
      id: 'patient-1',
      therapistId: 'therapist-1',
      deletedAt: null,
    });
    // El email del terapeuta no se imprime en la ficha: no se lee.
    expect(args[0].include.therapist.select).toEqual({ name: true });
  });

  it('genera un PDF no vacío con los datos del paciente y sus consultas', async () => {
    prisma.patient.findFirst.mockResolvedValue(buildPatientWithConsultations());

    const buffer = await service.generatePatientReport(
      'patient-1',
      'therapist-1',
    );

    // %PDF- es la cabecera estándar de cualquier PDF válido — confirma que
    // pdfkit efectivamente generó un documento real, no solo un Buffer vacío.
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('formatea las fechas con zona horaria explícita: instantes en Chile, fecha de nacimiento en UTC (issue #185)', async () => {
    const patient = buildPatientWithConsultations();
    patient.consultations[0].nextSessionDate = new Date('2026-02-10T12:00:00Z');
    prisma.patient.findFirst.mockResolvedValue(patient);
    const spy = jest.spyOn(Date.prototype, 'toLocaleDateString');

    try {
      await service.generatePatientReport('patient-1', 'therapist-1');

      const calls = spy.mock.calls.map(([, options]) => options);
      // "Generado el", sessionDate y nextSessionDate -> Santiago; birthDate -> UTC.
      expect(
        calls.filter((o) => o?.timeZone === 'America/Santiago'),
      ).toHaveLength(3);
      expect(calls.filter((o) => o?.timeZone === 'UTC')).toHaveLength(1);
      expect(calls.every((o) => o?.timeZone !== undefined)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('genera el PDF sin errores cuando las notas clínicas traen HTML enriquecido (issue #159)', async () => {
    const patient = buildPatientWithConsultations();
    patient.consultations = [
      {
        sessionDate: new Date('2026-01-10T12:00:00'),
        sessionType: 'IN_PERSON',
        consultReason:
          '<p>Motivo <strong>importante</strong> con <em>matices</em></p>',
        intervention:
          '<ul><li>Primera técnica</li><li>Segunda técnica</li></ul>',
        agreements: '<p><u>Acuerdo</u> firmado</p>',
        nextSessionDate: null,
      },
    ];
    prisma.patient.findFirst.mockResolvedValue(patient);

    const buffer = await service.generatePatientReport(
      'patient-1',
      'therapist-1',
    );

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(0);
  });

  // ADR 0004 (opción B): la ficha guarda los textos cifrados; el PDF los
  // renderiza en claro.
  it('descifra los textos clínicos antes de renderizarlos en el PDF', async () => {
    const crypto = buildTestClinicalCrypto();
    const render = jest.spyOn(clinicalNotePdf, 'renderClinicalNoteToPdf');
    const patient = buildPatientWithConsultations();
    patient.consultations = [
      {
        sessionDate: new Date('2026-01-10T12:00:00'),
        sessionType: 'IN_PERSON',
        consultReason: crypto.encrypt('<p>Motivo reservado</p>'),
        intervention: crypto.encrypt('<p>Intervención reservada</p>'),
        agreements: crypto.encrypt('<p>Acuerdo reservado</p>'),
        nextSessionDate: null,
      },
    ];
    prisma.patient.findFirst.mockResolvedValue(patient);

    await service.generatePatientReport('patient-1', 'therapist-1');

    const rendered = render.mock.calls.map((call) => call[1]);
    expect(rendered).toEqual([
      '<p>Motivo reservado</p>',
      '<p>Intervención reservada</p>',
      '<p>Acuerdo reservado</p>',
    ]);
    render.mockRestore();
  });

  it('consulta solo sesiones ya ocurridas, ordenadas por sessionDate y no por createdAt (issue #288)', async () => {
    prisma.patient.findFirst.mockResolvedValue(buildPatientWithConsultations());
    const before = Date.now();

    await service.generatePatientReport('patient-1', 'therapist-1');

    const args = prisma.patient.findFirst.mock.calls[0] as [
      {
        include: {
          consultations: {
            where: {
              correctedBy: null;
              deletedAt: null;
              sessionDate: { lte: Date };
            };
            orderBy: unknown;
          };
        };
      },
    ];
    const { where, orderBy } = args[0].include.consultations;
    expect(orderBy).toEqual({ sessionDate: 'asc' });
    expect(where.correctedBy).toBeNull();
    expect(where.deletedAt).toBeNull();
    // El tope es "ahora": las reservas futuras quedan fuera de la ficha.
    expect(where.sessionDate.lte.getTime()).toBeGreaterThanOrEqual(before);
    expect(where.sessionDate.lte.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('funciona también sin consultas registradas', async () => {
    const patient = buildPatientWithConsultations();
    patient.consultations = [];
    prisma.patient.findFirst.mockResolvedValue(patient);

    const buffer = await service.generatePatientReport(
      'patient-1',
      'therapist-1',
    );

    expect(buffer.length).toBeGreaterThan(0);
  });

  // Issue #504: el PDF es el registro clínico oficial; no basta con que
  // empiece con %PDF-. Se captura lo que se dibuja con doc.text().
  describe('contenido de la ficha', () => {
    let textSpy: jest.SpyInstance<unknown, unknown[]>;
    const drawn = () =>
      textSpy.mock.calls
        .map(([text]) => text)
        .filter((text): text is string => typeof text === 'string');

    beforeEach(() => {
      // Sin mockImplementation: llama al text() real y solo registra.
      textSpy = jest.spyOn(
        PDFDocument.prototype as { text: (...args: unknown[]) => unknown },
        'text',
      );
    });

    afterEach(() => {
      textSpy.mockRestore();
    });

    it('imprime la identificación del paciente, el psicólogo y el estado de los consentimientos', async () => {
      prisma.patient.findFirst.mockResolvedValue(
        buildPatientWithConsultations(),
      );

      await service.generatePatientReport('patient-1', 'therapist-1');

      expect(drawn()).toEqual(
        expect.arrayContaining([
          '1. Identificación del Paciente',
          'Nombre completo: Paciente de Prueba',
          'RUT: 11111111-1',
          'Fecha de nacimiento: 01-01-1990',
          'Ocupación: No registrada',
          'Psicólogo/a tratante: Dra. Terapeuta',
          'Consentimiento informado: Firmado',
          'Acuerdo telemedicina: Pendiente',
        ]),
      );
    });

    it('no imprime el email del terapeuta', async () => {
      prisma.patient.findFirst.mockResolvedValue(
        buildPatientWithConsultations(),
      );

      await service.generatePatientReport('patient-1', 'therapist-1');

      expect(drawn().join('\n')).not.toContain('terapeuta@umbral.cl');
    });

    it('imprime cada sesión numerada con su tipo, "Ninguno" sin acuerdos y "No agendada" sin próxima sesión', async () => {
      prisma.patient.findFirst.mockResolvedValue(
        buildPatientWithConsultations(),
      );

      await service.generatePatientReport('patient-1', 'therapist-1');

      expect(drawn()).toEqual(
        expect.arrayContaining([
          '2. Historial Clínico',
          expect.stringMatching(/^Sesión 1 {2}— {2}10-01-2026$/),
          'Tipo: Presencial',
          'Acuerdos:',
          'Ninguno',
          'Próxima sesión: No agendada',
        ]),
      );
      expect(drawn()).not.toContain('Sin consultas registradas.');
    });

    it('rotula la telemedicina y numera las sesiones en el orden recibido', async () => {
      const patient = buildPatientWithConsultations();
      patient.consultations = [
        { ...patient.consultations[0], sessionType: 'TELEMEDICINE' },
        { ...patient.consultations[0], sessionType: 'IN_PERSON' },
      ];
      prisma.patient.findFirst.mockResolvedValue(patient);

      await service.generatePatientReport('patient-1', 'therapist-1');

      const sessions = drawn().filter((t) => t.startsWith('Sesión '));
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toMatch(/^Sesión 1 /);
      expect(sessions[1]).toMatch(/^Sesión 2 /);
      expect(drawn().filter((t) => t.startsWith('Tipo: '))).toEqual([
        'Tipo: Telemedicina',
        'Tipo: Presencial',
      ]);
    });

    it('sin consultas imprime "Sin consultas registradas." y ninguna sesión', async () => {
      const patient = buildPatientWithConsultations();
      patient.consultations = [];
      prisma.patient.findFirst.mockResolvedValue(patient);

      await service.generatePatientReport('patient-1', 'therapist-1');

      expect(drawn()).toContain('Sin consultas registradas.');
      expect(drawn().some((t) => t.startsWith('Sesión '))).toBe(false);
    });
  });
});
