import { ConflictException, NotFoundException } from '@nestjs/common';
import { Patient } from '@prisma/client';
import { PatientsService } from './patients.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

function buildPatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 'patient-1',
    fullName: 'Paciente de Prueba',
    rut: '11.111.111-1',
    birthDate: new Date('1990-01-01'),
    occupation: null,
    address: null,
    phone: null,
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    treatingPsychiatrist: null,
    treatingDoctor: null,
    isActive: true,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    therapistId: 'therapist-1',
    ...overrides,
  } as unknown as Patient;
}

describe('PatientsService', () => {
  let service: PatientsService;
  let prisma: {
    patient: {
      findUnique: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    patientConsent: { findMany: jest.Mock; create: jest.Mock };
    patientHistory: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      patient: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      patientConsent: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      patientHistory: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      // $transaction([...]) real ejecuta cada operación y devuelve sus
      // resultados; para el caso callback (usado en update) alcanza con
      // invocar la función pasándole el propio mock de prisma como `tx`.
      $transaction: jest.fn((arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => unknown)(prisma);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };

    const auditService = { log: jest.fn() } as unknown as AuditService;

    service = new PatientsService(
      prisma as unknown as PrismaService,
      auditService,
    );
  });

  describe('create', () => {
    it('lanza 409 si ya existe un paciente con ese RUT', async () => {
      prisma.patient.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create(
          {
            fullName: 'Nuevo Paciente',
            rut: '11.111.111-1',
            birthDate: '1990-01-01',
          } as never,
          'therapist-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('normaliza el RUT (sin puntos, mayúsculas) antes de crear', async () => {
      prisma.patient.findUnique.mockResolvedValue(null);
      prisma.patient.create.mockResolvedValue(buildPatient());

      await service.create(
        {
          fullName: 'Nuevo Paciente',
          rut: '11.111.111-1k',
          birthDate: '1990-01-01',
        } as never,
        'therapist-1',
      );

      expect(prisma.patient.findUnique).toHaveBeenCalledWith({
        where: { rut: '11111111-1K' },
        select: { id: true },
      });
      expect(prisma.patient.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          rut: '11111111-1K',
          therapistId: 'therapist-1',
        }) as unknown,
      });
    });
  });

  describe('findAll', () => {
    it('sin pagination devuelve la lista completa con consents agregados', async () => {
      prisma.patient.findMany.mockResolvedValue([buildPatient()]);
      prisma.patientConsent.findMany.mockResolvedValue([]);

      const result = await service.findAll('therapist-1');

      expect(Array.isArray(result)).toBe(true);
      expect((result as { consents: unknown }[])[0].consents).toEqual({
        TREATMENT: false,
        TELEMEDICINE: false,
      });
      expect(prisma.patient.count).not.toHaveBeenCalled();
    });

    it('con page/pageSize pagina con take/skip y devuelve total', async () => {
      prisma.patient.findMany.mockResolvedValue([buildPatient()]);
      prisma.patient.count.mockResolvedValue(1);
      prisma.patientConsent.findMany.mockResolvedValue([]);

      const result = await service.findAll('therapist-1', {
        page: 2,
        pageSize: 10,
      });

      expect(prisma.patient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 10 }),
      );
      expect(result).toEqual(
        expect.objectContaining({ total: 1, page: 2, pageSize: 10 }),
      );
    });
  });

  describe('assertAccess', () => {
    it('lanza 404 si el paciente no existe o no pertenece al terapeuta', async () => {
      prisma.patient.findFirst.mockResolvedValue(null);

      await expect(
        service.assertAccess('patient-1', 'therapist-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('devuelve { id, rut } si el paciente pertenece al terapeuta', async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: 'patient-1',
        rut: '11111111-1',
      });

      const result = await service.assertAccess('patient-1', 'therapist-1');

      expect(result).toEqual({ id: 'patient-1', rut: '11111111-1' });
    });
  });

  describe('findOne', () => {
    it('lanza 404 si el paciente no existe', async () => {
      prisma.patient.findFirst.mockResolvedValue(null);

      await expect(service.findOne('patient-1', 'therapist-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('devuelve el paciente con el estado de consentimiento vigente', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patientConsent.findMany.mockResolvedValue([
        {
          patientId: 'patient-1',
          purpose: 'TREATMENT',
          action: 'GRANT',
        },
      ]);

      const result = await service.findOne('patient-1', 'therapist-1');

      expect(result.consents).toEqual({
        TREATMENT: true,
        TELEMEDICINE: false,
      });
    });
  });

  describe('update', () => {
    it('sin cambios reales no toca la DB y devuelve el paciente actual', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patientConsent.findMany.mockResolvedValue([]);

      await service.update(
        'patient-1',
        {
          fullName: 'Paciente de Prueba',
          reason: 'Motivo sin cambios reales',
        } as never,
        'therapist-1',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.patient.update).not.toHaveBeenCalled();
    });

    it('con cambios reales guarda el diff en PatientHistory y actualiza el paciente', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patientConsent.findMany.mockResolvedValue([]);
      prisma.patient.update.mockResolvedValue(
        buildPatient({ fullName: 'Nombre Actualizado' }),
      );

      await service.update(
        'patient-1',
        {
          fullName: 'Nombre Actualizado',
          reason: 'Corrección de nombre mal escrito',
        } as never,
        'therapist-1',
      );

      expect(prisma.patientHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: 'patient-1',
            changedById: 'therapist-1',
            reason: 'Corrección de nombre mal escrito',
          }) as unknown,
        }),
      );
      expect(prisma.patient.update).toHaveBeenCalledWith({
        where: { id: 'patient-1' },
        data: expect.objectContaining({
          fullName: 'Nombre Actualizado',
        }) as unknown,
      });
    });

    it('normaliza el RUT cuando el campo rut cambia', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patientConsent.findMany.mockResolvedValue([]);
      prisma.patient.update.mockResolvedValue(buildPatient());

      await service.update(
        'patient-1',
        {
          rut: '22.222.222-2',
          reason: 'RUT ingresado con error de tipeo',
        } as never,
        'therapist-1',
      );

      expect(prisma.patient.update).toHaveBeenCalledWith({
        where: { id: 'patient-1' },
        data: expect.objectContaining({ rut: '22222222-2' }) as unknown,
      });
    });
  });

  describe('softDelete', () => {
    it('valida acceso y marca deletedAt', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patient.update.mockResolvedValue(
        buildPatient({ deletedAt: new Date() }),
      );

      await service.softDelete('patient-1', 'therapist-1');

      expect(prisma.patient.update).toHaveBeenCalledWith({
        where: { id: 'patient-1' },
        data: { deletedAt: expect.any(Date) as unknown as Date },
      });
    });

    it('lanza 404 si el paciente no pertenece al terapeuta', async () => {
      prisma.patient.findFirst.mockResolvedValue(null);

      await expect(
        service.softDelete('patient-1', 'therapist-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.patient.update).not.toHaveBeenCalled();
    });
  });

  describe('getHistory', () => {
    it('valida acceso antes de devolver el historial', async () => {
      prisma.patient.findFirst.mockResolvedValue(null);

      await expect(
        service.getHistory('patient-1', 'therapist-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.patientHistory.findMany).not.toHaveBeenCalled();
    });

    it('devuelve el historial ordenado por changedAt desc', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patientHistory.findMany.mockResolvedValue([{ id: 'history-1' }]);

      const result = await service.getHistory('patient-1', 'therapist-1');

      expect(prisma.patientHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { patientId: 'patient-1' },
          orderBy: { changedAt: 'desc' },
        }),
      );
      expect(result).toEqual([{ id: 'history-1' }]);
    });
  });

  describe('recordConsent / getConsentLedger / getCurrentConsentStatus', () => {
    it('recordConsent valida acceso y crea el evento en el ledger', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patientConsent.create.mockResolvedValue({ id: 'consent-1' });

      await service.recordConsent(
        'patient-1',
        {
          purpose: 'TREATMENT',
          action: 'GRANT',
          evidence: 'Firmado en papel, escaneado y adjunto al expediente',
        } as never,
        'therapist-1',
      );

      expect(prisma.patientConsent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          patientId: 'patient-1',
          purpose: 'TREATMENT',
          action: 'GRANT',
          recordedById: 'therapist-1',
        }) as unknown,
      });
    });

    it('getConsentLedger valida acceso antes de devolver el ledger completo', async () => {
      prisma.patient.findFirst.mockResolvedValue(null);

      await expect(
        service.getConsentLedger('patient-1', 'therapist-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('getCurrentConsentStatus deriva el estado vigente del ledger', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patientConsent.findMany.mockResolvedValue([
        { patientId: 'patient-1', purpose: 'TELEMEDICINE', action: 'GRANT' },
      ]);

      const result = await service.getCurrentConsentStatus(
        'patient-1',
        'therapist-1',
      );

      expect(result).toEqual({ TREATMENT: false, TELEMEDICINE: true });
    });
  });
});
