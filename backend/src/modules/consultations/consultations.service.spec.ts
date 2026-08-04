import { ConflictException, NotFoundException } from '@nestjs/common';
import { Consultation } from '@prisma/client';
import { ConsultationsService } from './consultations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';

function buildConsultation(
  overrides: Partial<Consultation> = {},
): Consultation {
  return {
    id: 'consultation-1',
    groupId: 'consultation-1',
    patientId: 'patient-1',
    therapistId: 'therapist-1',
    sessionDate: new Date('2026-01-10T12:00:00'),
    consultReason: 'Motivo de consulta original',
    intervention: 'Intervención original',
    agreements: null,
    nextSessionDate: null,
    sessionType: 'IN_PERSON',
    createdAt: new Date(),
    scheduledAt: new Date('2026-01-10T12:00:00'),
    reminderSent: false,
    patientRut: '11111111-1',
    deletedAt: null,
    correctsId: null,
    correctedBy: null,
    ...overrides,
  } as unknown as Consultation;
}

describe('ConsultationsService', () => {
  let service: ConsultationsService;
  let prisma: {
    consultation: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
    };
    consultationHistory: { findMany: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let patientsService: { assertAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      consultation: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
      },
      consultationHistory: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      $transaction: jest.fn((arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => unknown)(prisma);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };
    patientsService = {
      assertAccess: jest
        .fn()
        .mockResolvedValue({ id: 'patient-1', rut: '11111111-1' }),
    };

    service = new ConsultationsService(
      prisma as unknown as PrismaService,
      patientsService as unknown as PatientsService,
    );
  });

  describe('create', () => {
    it('valida acceso al paciente antes de crear la consulta', async () => {
      patientsService.assertAccess.mockRejectedValue(
        new NotFoundException('Paciente no encontrado'),
      );

      await expect(
        service.create(
          {
            patientId: 'patient-1',
            sessionDate: '2026-01-10',
            consultReason: 'Motivo',
            intervention: 'Intervención',
          } as never,
          'therapist-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.consultation.create).not.toHaveBeenCalled();
    });

    it('usa el rut del paciente cuando el DTO no trae patientRut', async () => {
      prisma.consultation.create.mockResolvedValue(buildConsultation());

      await service.create(
        {
          patientId: 'patient-1',
          sessionDate: '2026-01-10',
          consultReason: 'Motivo',
          intervention: 'Intervención',
        } as never,
        'therapist-1',
      );

      expect(prisma.consultation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          patientId: 'patient-1',
          patientRut: '11111111-1',
          therapistId: 'therapist-1',
        }) as unknown,
      });
    });

    it('groupId de la primera versión es igual a su propio id', async () => {
      prisma.consultation.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(buildConsultation(data as never)),
      );

      const result = await service.create(
        {
          patientId: 'patient-1',
          sessionDate: '2026-01-10',
          consultReason: 'Motivo',
          intervention: 'Intervención',
        } as never,
        'therapist-1',
      );

      expect(result.groupId).toBe(result.id);
    });
  });

  describe('findByPatient', () => {
    it('valida acceso y agrega el historial vigente por consulta', async () => {
      prisma.consultation.findMany.mockResolvedValue([buildConsultation()]);
      prisma.consultationHistory.findMany.mockResolvedValue([
        { consultationId: 'consultation-1', id: 'history-1' },
      ]);

      const result = await service.findByPatient('patient-1', 'therapist-1');

      expect(patientsService.assertAccess).toHaveBeenCalledWith(
        'patient-1',
        'therapist-1',
      );
      expect((result as { history: unknown[] }[])[0].history).toHaveLength(1);
    });

    it('con pagination pagina con take/skip y devuelve total', async () => {
      prisma.consultation.findMany.mockResolvedValue([buildConsultation()]);
      prisma.consultation.count.mockResolvedValue(1);

      const result = await service.findByPatient('patient-1', 'therapist-1', {
        page: 1,
        pageSize: 5,
      });

      expect(prisma.consultation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, skip: 0 }),
      );
      expect(result).toEqual(expect.objectContaining({ total: 1 }));
    });
  });

  describe('getStats', () => {
    it('cuenta el total y las próximas (nextSessionDate futura)', async () => {
      prisma.consultation.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(3);

      const result = await service.getStats('therapist-1');

      expect(result).toEqual({ total: 10, upcoming: 3 });
    });
  });

  describe('findOne', () => {
    it('lanza 404 si la consulta no existe', async () => {
      prisma.consultation.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('consultation-1', 'therapist-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('valida acceso al paciente dueño de la consulta', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());

      await service.findOne('consultation-1', 'therapist-1');

      expect(patientsService.assertAccess).toHaveBeenCalledWith(
        'patient-1',
        'therapist-1',
      );
    });
  });

  describe('correct', () => {
    it('lanza 409 si la versión ya fue corregida', async () => {
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce({ id: 'already-corrected' });

      await expect(
        service.correct(
          'consultation-1',
          { consultReason: 'Motivo corregido' } as never,
          'therapist-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('crea una fila nueva sin modificar la original y guarda el snapshot previo', async () => {
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({
          id: 'consultation-2',
          correctsId: 'consultation-1',
        }),
      );

      const result = await service.correct(
        'consultation-1',
        { consultReason: 'Motivo corregido' } as never,
        'therapist-1',
      );

      expect(prisma.consultationHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            consultationId: 'consultation-1',
            editedById: 'therapist-1',
          }) as unknown,
        }),
      );
      expect(prisma.consultation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            correctsId: 'consultation-1',
            consultReason: 'Motivo corregido',
          }) as unknown,
        }),
      );
      expect(result.id).toBe('consultation-2');
    });
  });
});
