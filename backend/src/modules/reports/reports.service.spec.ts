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
        agreements: null,
        nextSessionDate: null,
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
