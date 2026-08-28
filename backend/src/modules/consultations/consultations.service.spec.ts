import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Consultation } from '@prisma/client';
import { ConsultationsService } from './consultations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';

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
    calendarEventLink: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let patientsService: { assertAccess: jest.Mock };
  let calendarSync: { syncGroup: jest.Mock };

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
      calendarEventLink: {
        findMany: jest.fn().mockResolvedValue([]),
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
    calendarSync = { syncGroup: jest.fn().mockResolvedValue(undefined) };

    service = new ConsultationsService(
      prisma as unknown as PrismaService,
      patientsService as unknown as PatientsService,
      calendarSync as unknown as CalendarSyncService,
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

    // sdd/google-calendar-integration T5.5: design.md "create()/correct()
    // call void this.calendarSync.syncGroup(groupId).catch(log) after their
    // transaction commits".
    it('dispara calendarSync.syncGroup(groupId) tras persistir la consulta', async () => {
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

      expect(calendarSync.syncGroup).toHaveBeenCalledWith('consultation-1');
    });

    it('un rechazo de calendarSync.syncGroup no impide que create() se resuelva (T non-blocking)', async () => {
      prisma.consultation.create.mockResolvedValue(buildConsultation());
      calendarSync.syncGroup.mockRejectedValue(
        new Error('Google no disponible'),
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
      ).resolves.toEqual(expect.objectContaining({ id: 'consultation-1' }));
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

    // sdd/google-calendar-integration T5.6
    it('dispara calendarSync.syncGroup(groupId) tras persistir la corrección', async () => {
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({
          id: 'consultation-2',
          correctsId: 'consultation-1',
        }),
      );

      await service.correct(
        'consultation-1',
        { consultReason: 'Motivo corregido' } as never,
        'therapist-1',
      );

      expect(calendarSync.syncGroup).toHaveBeenCalledWith('consultation-1');
    });

    it('un rechazo de calendarSync.syncGroup no impide que correct() se resuelva (T non-blocking)', async () => {
      prisma.consultation.findFirst
        .mockResolvedValueOnce(buildConsultation())
        .mockResolvedValueOnce(null);
      prisma.consultation.create.mockResolvedValue(
        buildConsultation({
          id: 'consultation-2',
          correctsId: 'consultation-1',
        }),
      );
      calendarSync.syncGroup.mockRejectedValue(
        new Error('Google no disponible'),
      );

      await expect(
        service.correct(
          'consultation-1',
          { consultReason: 'Motivo corregido' } as never,
          'therapist-1',
        ),
      ).resolves.toEqual(expect.objectContaining({ id: 'consultation-2' }));
    });
  });

  // sdd/session-calendar-view PR1 (T1.2-1.4): design.md "Range query params
  // are ISO instants with explicit offset, half-open" + "Sync badge resolved
  // in the same response, via in-memory map" + "Grid payload excludes
  // clinical narrative".
  describe('findByRange', () => {
    const therapistId = 'therapist-1';

    function buildRangeConsultation(
      overrides: Partial<Consultation> & {
        patient?: { fullName: string };
      } = {},
    ) {
      const { patient, ...rest } = overrides;
      return {
        ...buildConsultation(rest),
        patient: patient ?? { fullName: 'Paciente Uno' },
      };
    }

    it('consulta filtrando therapistId, correctedBy null y deletedAt null dentro del rango solicitado', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);

      await service.findByRange(therapistId, {
        from: '2026-09-01T00:00:00-04:00',
        to: '2026-10-01T00:00:00-03:00',
      });

      expect(prisma.consultation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            therapistId,
            correctedBy: null,
            deletedAt: null,
            sessionDate: {
              gte: new Date('2026-09-01T00:00:00-04:00'),
              lt: new Date('2026-10-01T00:00:00-03:00'),
            },
          },
        }) as unknown,
      );
    });

    it('el límite "to" es exclusivo (half-open) y "from" es inclusivo', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);

      await service.findByRange(therapistId, {
        from: '2026-09-01T00:00:00-04:00',
        to: '2026-09-02T00:00:00-04:00',
      });

      expect(prisma.consultation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sessionDate: {
              gte: new Date('2026-09-01T00:00:00-04:00'),
              lt: new Date('2026-09-02T00:00:00-04:00'),
            },
          }) as unknown,
        }) as unknown,
      );
    });

    it('lanza BadRequestException si "to" es menor o igual a "from"', async () => {
      await expect(
        service.findByRange(therapistId, {
          from: '2026-09-05T00:00:00-04:00',
          to: '2026-09-05T00:00:00-04:00',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.consultation.findMany).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el rango solicitado supera los 62 días', async () => {
      await expect(
        service.findByRange(therapistId, {
          // 68 días
          from: '2026-01-01T00:00:00-04:00',
          to: '2026-03-10T00:00:00-04:00',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.consultation.findMany).not.toHaveBeenCalled();
    });

    it('acepta un rango de exactamente 62 días', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);

      await expect(
        service.findByRange(therapistId, {
          // exactamente 62 días
          from: '2026-01-01T00:00:00-04:00',
          to: '2026-03-04T00:00:00-04:00',
        }),
      ).resolves.toEqual([]);
    });

    it('arma un mapa de sincronización por groupId y lo fusiona en la respuesta', async () => {
      prisma.consultation.findMany.mockResolvedValue([
        buildRangeConsultation({
          id: 'c-1',
          groupId: 'group-1',
          patient: { fullName: 'Ana Paz' },
        }),
        buildRangeConsultation({
          id: 'c-2',
          groupId: 'group-2',
          patient: { fullName: 'Beto Ruiz' },
        }),
        buildRangeConsultation({
          id: 'c-3',
          groupId: 'group-3',
          patient: { fullName: 'Caro Diaz' },
        }),
      ] as never);
      prisma.calendarEventLink.findMany.mockResolvedValue([
        { groupId: 'group-1', syncStatus: 'SYNCED' },
        { groupId: 'group-2', syncStatus: 'FAILED' },
      ]);

      const result = await service.findByRange(therapistId, {
        from: '2026-09-01T00:00:00-04:00',
        to: '2026-10-01T00:00:00-03:00',
      });

      expect(result.find((s) => s.groupId === 'group-1')?.calendarSync).toBe(
        'SYNCED',
      );
      expect(result.find((s) => s.groupId === 'group-2')?.calendarSync).toBe(
        'FAILED',
      );
      expect(
        result.find((s) => s.groupId === 'group-3')?.calendarSync,
      ).toBeNull();
      expect(prisma.calendarEventLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            connection: { therapistId },
            groupId: { in: ['group-1', 'group-2', 'group-3'] },
          }) as unknown,
        }) as unknown,
      );
    });

    it('devuelve solo los campos del contrato CalendarSession, sin PHI clínico', async () => {
      prisma.consultation.findMany.mockResolvedValue([
        buildRangeConsultation({
          id: 'c-1',
          groupId: 'group-1',
          patientId: 'patient-9',
          sessionDate: new Date('2026-09-10T15:00:00.000Z'),
          sessionType: 'TELEMED',
          patient: { fullName: 'Dana Vera' },
        }),
      ] as never);

      const [session] = await service.findByRange(therapistId, {
        from: '2026-09-01T00:00:00-04:00',
        to: '2026-10-01T00:00:00-03:00',
      });

      expect(session).toEqual({
        id: 'c-1',
        groupId: 'group-1',
        sessionDate: '2026-09-10T15:00:00.000Z',
        sessionType: 'TELEMED',
        patientId: 'patient-9',
        patientName: 'Dana Vera',
        calendarSync: null,
      });
    });

    it('no consulta calendarEventLink cuando no hay sesiones en el rango', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);

      const result = await service.findByRange(therapistId, {
        from: '2026-09-01T00:00:00-04:00',
        to: '2026-10-01T00:00:00-03:00',
      });

      expect(result).toEqual([]);
      expect(prisma.calendarEventLink.findMany).not.toHaveBeenCalled();
    });
  });
});
