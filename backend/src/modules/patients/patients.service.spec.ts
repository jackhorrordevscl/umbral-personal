import { ConflictException, NotFoundException } from '@nestjs/common';
import { Patient } from '@prisma/client';
import { PatientsService } from './patients.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import { PaymentsService } from '../payments/payments.service';

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
  let calendarSync: { deletePatientEvents: jest.Mock };
  let paymentsService: { cancelUnpaidForPatient: jest.Mock };

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
    calendarSync = {
      deletePatientEvents: jest.fn().mockResolvedValue(undefined),
    };
    paymentsService = {
      cancelUnpaidForPatient: jest.fn().mockResolvedValue(undefined),
    };

    service = new PatientsService(
      prisma as unknown as PrismaService,
      auditService,
      calendarSync as unknown as CalendarSyncService,
      paymentsService as unknown as PaymentsService,
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

    // sdd/google-calendar-integration T5.7: design.md "Confirmed Decisions"
    // -- DELETE /patients/:id es el único disparador real de borrado de
    // eventos de Google hoy (ningún endpoint escribe Consultation.deletedAt
    // todavía).
    it('dispara calendarSync.deletePatientEvents(id) tras el soft-delete', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patient.update.mockResolvedValue(
        buildPatient({ deletedAt: new Date() }),
      );

      await service.softDelete('patient-1', 'therapist-1');

      expect(calendarSync.deletePatientEvents).toHaveBeenCalledWith(
        'patient-1',
      );
    });

    it('un rechazo de calendarSync.deletePatientEvents no impide que softDelete() se resuelva (non-blocking)', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patient.update.mockResolvedValue(
        buildPatient({ deletedAt: new Date() }),
      );
      calendarSync.deletePatientEvents.mockRejectedValue(
        new Error('Google no disponible'),
      );

      await expect(
        service.softDelete('patient-1', 'therapist-1'),
      ).resolves.toEqual(expect.objectContaining({ id: 'patient-1' }));
    });

    // issue #110: sin esto, los cargos PENDING/LATE del paciente eliminado
    // seguían en pie para el sweep cron y podían transicionar a PAID después
    // de que el paciente ya no existiera.
    it('llama a paymentsService.cancelUnpaidForPatient(id) tras el soft-delete', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patient.update.mockResolvedValue(
        buildPatient({ deletedAt: new Date() }),
      );

      await service.softDelete('patient-1', 'therapist-1');

      expect(paymentsService.cancelUnpaidForPatient).toHaveBeenCalledWith(
        'patient-1',
      );
    });

    it('un rechazo de paymentsService.cancelUnpaidForPatient no impide que softDelete() se resuelva (non-blocking)', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patient.update.mockResolvedValue(
        buildPatient({ deletedAt: new Date() }),
      );
      paymentsService.cancelUnpaidForPatient.mockRejectedValue(
        new Error('Fallo al cancelar cargos'),
      );

      await expect(
        service.softDelete('patient-1', 'therapist-1'),
      ).resolves.toEqual(expect.objectContaining({ id: 'patient-1' }));
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

  // sdd/patient-self-scheduling PR 3 (tasks.md 3.4, design.md "Identity
  // resolution gotchas"): Patient.rut es GLOBALMENTE único (no por
  // terapeuta) -- un paciente ya registrado con otro terapeuta no puede
  // auto-crearse. Patient.email es nullable y NO único -- el match es
  // case-insensitive y scopeado a therapistId; más de un match es ambiguo.
  // Ambos casos devuelven el MISMO 409 uniforme, sin distinguir hacia
  // afuera cuál ocurrió.
  describe('resolveForPublicBooking', () => {
    const dto = {
      fullName: 'Paciente Público',
      rut: '11.111.111-1',
      birthDate: '1990-01-01',
      email: 'paciente@ejemplo.cl',
    };

    it('vincula a la ficha existente si hay un único match de email bajo ese terapeuta', async () => {
      const existing = buildPatient({ email: 'paciente@ejemplo.cl' });
      prisma.patient.findMany.mockResolvedValue([existing]);

      const result = await service.resolveForPublicBooking(
        'therapist-1',
        dto as never,
      );

      expect(result).toBe(existing);
      expect(prisma.patient.findMany).toHaveBeenCalledWith({
        where: {
          therapistId: 'therapist-1',
          deletedAt: null,
          email: { equals: 'paciente@ejemplo.cl', mode: 'insensitive' },
        },
      });
      expect(prisma.patient.create).not.toHaveBeenCalled();
    });

    it('crea una nueva ficha reducida si no hay match de email bajo ese terapeuta', async () => {
      prisma.patient.findMany.mockResolvedValue([]);
      prisma.patient.findUnique.mockResolvedValue(null);
      const created = buildPatient({ email: 'paciente@ejemplo.cl' });
      prisma.patient.create.mockResolvedValue(created);

      const result = await service.resolveForPublicBooking(
        'therapist-1',
        dto as never,
      );

      expect(result).toBe(created);
      expect(prisma.patient.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          rut: '11111111-1',
          email: 'paciente@ejemplo.cl',
          therapistId: 'therapist-1',
        }) as unknown,
      });
      // Campos explícitamente excluidos del formulario público reducido
      // (design.md: "Creation explicitly omits defaultSessionAmount,
      // documents, and consents").
      const firstCallArgs = prisma.patient.create.mock.calls[0] as unknown[];
      const createCall = firstCallArgs[0] as {
        data: Record<string, unknown>;
      };
      expect(createCall.data.defaultSessionAmount).toBeUndefined();
    });

    it('colisión de RUT con otro terapeuta -> 409 uniforme, sin crear ni filtrar el caso', async () => {
      prisma.patient.findMany.mockResolvedValue([]);
      prisma.patient.findUnique.mockResolvedValue({
        id: 'other-patient',
        therapistId: 'therapist-2',
      });

      await expect(
        service.resolveForPublicBooking('therapist-1', dto as never),
      ).rejects.toThrow(ConflictException);
      expect(prisma.patient.create).not.toHaveBeenCalled();
    });

    it('email ambiguo (más de un match bajo el mismo terapeuta) -> mismo 409 uniforme', async () => {
      prisma.patient.findMany.mockResolvedValue([
        buildPatient({ id: 'p1' }),
        buildPatient({ id: 'p2' }),
      ]);

      await expect(
        service.resolveForPublicBooking('therapist-1', dto as never),
      ).rejects.toThrow(ConflictException);
      expect(prisma.patient.create).not.toHaveBeenCalled();
    });

    it('nunca loguea el email en texto plano al rechazar un match ambiguo', async () => {
      prisma.patient.findMany.mockResolvedValue([
        buildPatient({ id: 'p1' }),
        buildPatient({ id: 'p2' }),
      ]);
      const warnSpy = jest.spyOn(
        (service as unknown as { logger: { warn: (msg: string) => void } })
          .logger,
        'warn',
      );

      await expect(
        service.resolveForPublicBooking('therapist-1', dto as never),
      ).rejects.toThrow(ConflictException);

      for (const call of warnSpy.mock.calls) {
        expect(String(call[0])).not.toContain('paciente@ejemplo.cl');
      }
    });
  });
});
