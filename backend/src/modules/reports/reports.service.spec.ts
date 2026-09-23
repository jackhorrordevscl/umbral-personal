import { NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';
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
  let prisma: { patient: { findUnique: jest.Mock } };
  let patientsService: {
    assertAccess: jest.Mock;
    getConsentStatusMap: jest.Mock;
  };

  beforeEach(() => {
    prisma = { patient: { findUnique: jest.fn() } };
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
    );
  });

  it('valida acceso al paciente antes de generar el PDF', async () => {
    patientsService.assertAccess.mockRejectedValue(
      new NotFoundException('Paciente no encontrado'),
    );

    await expect(
      service.generatePatientReport('patient-1', 'therapist-1'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.patient.findUnique).not.toHaveBeenCalled();
  });

  it('lanza 404 si el paciente no existe', async () => {
    prisma.patient.findUnique.mockResolvedValue(null);

    await expect(
      service.generatePatientReport('patient-1', 'therapist-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('genera un PDF no vacío con los datos del paciente y sus consultas', async () => {
    prisma.patient.findUnique.mockResolvedValue(
      buildPatientWithConsultations(),
    );

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
    prisma.patient.findUnique.mockResolvedValue(patient);
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
    prisma.patient.findUnique.mockResolvedValue(patient);

    const buffer = await service.generatePatientReport(
      'patient-1',
      'therapist-1',
    );

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('funciona también sin consultas registradas', async () => {
    const patient = buildPatientWithConsultations();
    patient.consultations = [];
    prisma.patient.findUnique.mockResolvedValue(patient);

    const buffer = await service.generatePatientReport(
      'patient-1',
      'therapist-1',
    );

    expect(buffer.length).toBeGreaterThan(0);
  });
});
