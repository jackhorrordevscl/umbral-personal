import { ConflictException, NotFoundException } from '@nestjs/common';
import { Patient, Prisma } from '@prisma/client';
import { PatientsService } from './patients.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import { PaymentsService } from '../payments/payments.service';
import { AvailabilityService } from '../availability/availability.service';
import { UNPAGINATED_SAFETY_LIMIT } from '../../common/dto/pagination.dto';

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
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      groupBy: jest.Mock;
    };
    patientConsent: { findMany: jest.Mock; create: jest.Mock };
    patientHistory: { create: jest.Mock; findMany: jest.Mock };
    consultation: { findMany: jest.Mock };
    bookedSlot: { deleteMany: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let calendarSync: { deletePatientEvents: jest.Mock };
  let paymentsService: { cancelUnpaidForPatient: jest.Mock };
  let availabilityService: { invalidate: jest.Mock };

  beforeEach(() => {
    prisma = {
      patient: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn(),
      },
      patientConsent: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      patientHistory: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      consultation: { findMany: jest.fn().mockResolvedValue([]) },
      bookedSlot: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'patient-1' }]),
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

    availabilityService = { invalidate: jest.fn() };

    service = new PatientsService(
      prisma as unknown as PrismaService,
      auditService,
      calendarSync as unknown as CalendarSyncService,
      paymentsService as unknown as PaymentsService,
      availabilityService as unknown as AvailabilityService,
    );
  });

  describe('create', () => {
    it('lanza 409 si ya existe un paciente con ese RUT', async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: 'existing' });

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
      prisma.patient.findFirst.mockResolvedValue(null);
      prisma.patient.create.mockResolvedValue(buildPatient());

      await service.create(
        {
          fullName: 'Nuevo Paciente',
          rut: '11.111.111-1k',
          birthDate: '1990-01-01',
        } as never,
        'therapist-1',
      );

      expect(prisma.patient.findFirst).toHaveBeenCalledWith({
        where: {
          therapistId: 'therapist-1',
          rut: '11111111-1K',
          deletedAt: null,
        },
        select: { id: true },
      });
      expect(prisma.patient.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          rut: '11111111-1K',
          therapistId: 'therapist-1',
        }) as unknown,
      });
    });

    it('quita ceros iniciales del RUT para evitar duplicados (issue #289)', async () => {
      prisma.patient.findFirst.mockResolvedValue(null);
      prisma.patient.create.mockResolvedValue(buildPatient());

      await service.create(
        {
          fullName: 'Nuevo Paciente',
          rut: '012345678-5',
          birthDate: '1990-01-01',
        } as never,
        'therapist-1',
      );

      expect(prisma.patient.findFirst).toHaveBeenCalledWith({
        where: {
          therapistId: 'therapist-1',
          rut: '12345678-5',
          deletedAt: null,
        },
        select: { id: true },
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

    // issue #140: sin page/pageSize sigue devolviendo el array plano (no
    // { data, total, ... }), pero ya no dispara un findMany() sin ningún
    // límite -- aplica el cap de seguridad UNPAGINATED_SAFETY_LIMIT.
    it('sin pagination aplica el cap de seguridad en vez de un findMany() sin límite', async () => {
      prisma.patient.findMany.mockResolvedValue([]);
      prisma.patientConsent.findMany.mockResolvedValue([]);

      await service.findAll('therapist-1');

      expect(prisma.patient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: UNPAGINATED_SAFETY_LIMIT }),
      );
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

    it.each([
      ['campo nulo enviado como null', { occupation: null }],
      ['campo nulo enviado como cadena vacía', { phone: '' }],
      ['RUT con formato distinto al almacenado', { rut: '11111111-1' }],
      [
        'fecha de nacimiento solo-día igual a la almacenada',
        { birthDate: '1990-01-01' },
      ],
    ])('%s no cuenta como cambio (issue #283)', async (_label, fields) => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patientConsent.findMany.mockResolvedValue([]);

      await service.update(
        'patient-1',
        { ...fields, reason: 'Motivo sin cambios reales' } as never,
        'therapist-1',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.patientHistory.create).not.toHaveBeenCalled();
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

    it('RUT ya usado por otro paciente del terapeuta: P2002 -> 409 (issue #317)', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patientConsent.findMany.mockResolvedValue([]);
      prisma.patient.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update(
          'patient-1',
          {
            rut: '22.222.222-2',
            reason: 'RUT corregido a uno ya existente',
          } as never,
          'therapist-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('un error del update que no es P2002 se propaga sin traducir', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patientConsent.findMany.mockResolvedValue([]);
      const boom = new Error('conexión perdida');
      prisma.patient.update.mockRejectedValue(boom);

      await expect(
        service.update(
          'patient-1',
          { fullName: 'Otro Nombre', reason: 'Corrección de nombre' } as never,
          'therapist-1',
        ),
      ).rejects.toBe(boom);
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

    // issue #285: los slots liberados no deben seguir ocultos por el caché.
    it('invalida el caché de disponibilidad del terapeuta tras el soft-delete', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patient.update.mockResolvedValue(
        buildPatient({ deletedAt: new Date() }),
      );

      await service.softDelete('patient-1', 'therapist-1');

      expect(availabilityService.invalidate).toHaveBeenCalledWith(
        'therapist-1',
      );
    });

    // issue #285: sin liberar el BookedSlot, el horario seguía dando 409.
    it('libera los BookedSlot de las consultas del paciente en la misma transacción', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.consultation.findMany.mockResolvedValue([
        { groupId: 'g-1' },
        { groupId: 'g-2' },
      ]);
      prisma.patient.update.mockResolvedValue(
        buildPatient({ deletedAt: new Date() }),
      );

      await service.softDelete('patient-1', 'therapist-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.bookedSlot.deleteMany).toHaveBeenCalledWith({
        where: { groupId: { in: ['g-1', 'g-2'] } },
      });
    });

    // issue #285 (review parte 1): lock de la fila antes de leer los grupos.
    it('toma lock FOR UPDATE del paciente antes de leer sus consultas', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.consultation.findMany.mockResolvedValue([{ groupId: 'g-1' }]);
      prisma.patient.update.mockResolvedValue(
        buildPatient({ deletedAt: new Date() }),
      );

      await service.softDelete('patient-1', 'therapist-1');

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.consultation.findMany.mock.invocationCallOrder[0],
      );
    });

    it('no llama a bookedSlot.deleteMany si el paciente no tiene consultas', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patient.update.mockResolvedValue(
        buildPatient({ deletedAt: new Date() }),
      );

      await service.softDelete('patient-1', 'therapist-1');

      expect(prisma.bookedSlot.deleteMany).not.toHaveBeenCalled();
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

    it('bulkDeclareConsent crea el evento GRANT para cada paciente del lote (issue #131 T5)', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patientConsent.create.mockResolvedValue({ id: 'consent-x' });

      const results = await service.bulkDeclareConsent(
        {
          patientIds: ['patient-1', 'patient-2'],
          purpose: 'TREATMENT',
          evidence: 'Consentimiento en papel del expediente físico previo',
        } as never,
        'therapist-1',
      );

      expect(prisma.patientConsent.create).toHaveBeenCalledTimes(2);
      expect(results).toEqual([
        { patientId: 'patient-1', ok: true },
        { patientId: 'patient-2', ok: true },
      ]);
    });

    it('bulkDeclareConsent no aborta el lote si un paciente no pertenece al terapeuta', async () => {
      prisma.patient.findFirst
        .mockResolvedValueOnce(buildPatient())
        .mockResolvedValueOnce(null);
      prisma.patientConsent.create.mockResolvedValue({ id: 'consent-x' });

      const results = await service.bulkDeclareConsent(
        {
          patientIds: ['patient-1', 'ajeno-1'],
          purpose: 'TREATMENT',
          evidence: 'Consentimiento en papel del expediente físico previo',
        } as never,
        'therapist-1',
      );

      expect(prisma.patientConsent.create).toHaveBeenCalledTimes(1);
      expect(results).toEqual([
        { patientId: 'patient-1', ok: true },
        {
          patientId: 'ajeno-1',
          ok: false,
          error: 'Paciente no encontrado',
        },
      ]);
    });

    it('bulkDeclareConsent no filtra el mensaje de un error inesperado (review R3-002, issue #131)', async () => {
      prisma.patient.findFirst
        .mockResolvedValueOnce(buildPatient())
        .mockResolvedValueOnce(buildPatient());
      prisma.patientConsent.create
        .mockResolvedValueOnce({ id: 'consent-x' })
        .mockRejectedValueOnce(new Error('connection terminated unexpectedly'));

      const results = await service.bulkDeclareConsent(
        {
          patientIds: ['patient-1', 'patient-2'],
          purpose: 'TREATMENT',
          evidence: 'Consentimiento en papel del expediente físico previo',
        } as never,
        'therapist-1',
      );

      expect(results).toEqual([
        { patientId: 'patient-1', ok: true },
        {
          patientId: 'patient-2',
          ok: false,
          error: 'No se pudo registrar el consentimiento para este paciente.',
        },
      ]);
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
  // resolution gotchas"): Patient.rut es único POR
  // terapeuta (issue #314) -- un RUT registrado con otro terapeuta no
  // interfiere. Patient.email es nullable y NO único -- el match es
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

      expect(result).toEqual({ patient: existing, isNew: false });
      expect(prisma.patient.findMany).toHaveBeenCalledWith({
        where: {
          therapistId: 'therapist-1',
          deletedAt: null,
          email: { equals: 'paciente@ejemplo.cl', mode: 'insensitive' },
        },
      });
      expect(prisma.patient.create).not.toHaveBeenCalled();
    });

    // Issue #299 (opción A): el email solo no prueba identidad.
    it('el RUT enviado se compara normalizado (sin puntos, K mayúscula) con el guardado', async () => {
      const existing = buildPatient({
        email: 'paciente@ejemplo.cl',
        rut: '12345678-K',
      });
      prisma.patient.findMany.mockResolvedValue([existing]);

      const result = await service.resolveForPublicBooking('therapist-1', {
        ...dto,
        rut: ' 12.345.678-k ',
      } as never);

      expect(result).toEqual({ patient: existing, isNew: false });
    });

    it('email existente con un RUT distinto -> 409 uniforme, sin devolver la ficha (issue #299)', async () => {
      prisma.patient.findMany.mockResolvedValue([
        buildPatient({ email: 'paciente@ejemplo.cl', rut: '22222222-2' }),
      ]);

      const attempt = service.resolveForPublicBooking(
        'therapist-1',
        dto as never,
      );

      await expect(attempt).rejects.toThrow(ConflictException);
      await expect(attempt).rejects.toThrow(
        'No fue posible procesar la reserva.',
      );
      expect(prisma.patient.create).not.toHaveBeenCalled();
    });

    it('el mensaje del 409 por RUT distinto no revela qué campo falló ni el RUT guardado', async () => {
      prisma.patient.findMany.mockResolvedValue([
        buildPatient({ email: 'paciente@ejemplo.cl', rut: '22222222-2' }),
      ]);

      const error = (await service
        .resolveForPublicBooking('therapist-1', dto as never)
        .catch((e: unknown) => e)) as ConflictException;

      const message = JSON.stringify(error.getResponse());
      expect(message).not.toMatch(/rut/i);
      expect(message).not.toContain('22222222');
      expect(message).not.toMatch(/email/i);
    });

    it('usa el client transaccional recibido en vez de this.prisma', async () => {
      const tx = {
        patient: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(buildPatient()),
        },
      };

      await service.resolveForPublicBooking(
        'therapist-1',
        dto as never,
        undefined,
        tx as never,
      );

      expect(tx.patient.create).toHaveBeenCalled();
      expect(prisma.patient.findMany).not.toHaveBeenCalled();
      expect(prisma.patient.create).not.toHaveBeenCalled();
    });

    it('crea una nueva ficha reducida si no hay match de email bajo ese terapeuta', async () => {
      prisma.patient.findMany.mockResolvedValue([]);
      prisma.patient.findFirst.mockResolvedValue(null);
      const created = buildPatient({ email: 'paciente@ejemplo.cl' });
      prisma.patient.create.mockResolvedValue(created);

      const result = await service.resolveForPublicBooking(
        'therapist-1',
        dto as never,
      );

      expect(result).toEqual({ patient: created, isNew: true });
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

    it('colisión de RUT con una ficha de este terapeuta -> 409 uniforme, sin crear', async () => {
      prisma.patient.findMany.mockResolvedValue([]);
      prisma.patient.findFirst.mockResolvedValue({ id: 'own-patient' });

      await expect(
        service.resolveForPublicBooking('therapist-1', dto as never),
      ).rejects.toThrow(ConflictException);
      expect(prisma.patient.findFirst).toHaveBeenCalledWith({
        where: {
          therapistId: 'therapist-1',
          rut: '11111111-1',
          deletedAt: null,
        },
        select: { id: true },
      });
      expect(prisma.patient.create).not.toHaveBeenCalled();
    });

    it('RUT registrado solo con otro terapeuta -> crea la ficha (issue #314)', async () => {
      prisma.patient.findMany.mockResolvedValue([]);
      // La búsqueda acotada por terapeuta no encuentra la ficha del otro.
      prisma.patient.findFirst.mockResolvedValue(null);
      prisma.patient.create.mockResolvedValue(buildPatient());

      const result = await service.resolveForPublicBooking(
        'therapist-1',
        dto as never,
      );

      expect(result.isNew).toBe(true);
    });

    it('carrera de RUT: P2002 en el create -> mismo 409 uniforme (issue #199)', async () => {
      prisma.patient.findMany.mockResolvedValue([]);
      prisma.patient.findFirst.mockResolvedValue(null);
      prisma.patient.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.resolveForPublicBooking('therapist-1', dto as never),
      ).rejects.toThrow(ConflictException);
    });

    it('un error del create que no es P2002 se propaga sin traducir', async () => {
      prisma.patient.findMany.mockResolvedValue([]);
      prisma.patient.findFirst.mockResolvedValue(null);
      const boom = new Error('conexión perdida');
      prisma.patient.create.mockRejectedValue(boom);

      await expect(
        service.resolveForPublicBooking('therapist-1', dto as never),
      ).rejects.toBe(boom);
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

    // issue #157: acquisitionSource/acquisitionReferrer solo se setean en la
    // creación del paciente -- nunca al vincular a una ficha existente.
    describe('origin (issue #157)', () => {
      it('paciente nuevo con origin.source -> se persiste tal cual', async () => {
        prisma.patient.findMany.mockResolvedValue([]);
        prisma.patient.findFirst.mockResolvedValue(null);
        prisma.patient.create.mockResolvedValue(buildPatient());

        await service.resolveForPublicBooking('therapist-1', dto as never, {
          source: 'google',
          referrer: 'https://google.com/search?q=terapia',
        });

        expect(prisma.patient.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            acquisitionSource: 'google',
            acquisitionReferrer: 'https://google.com/search?q=terapia',
          }) as unknown,
        });
      });

      it('paciente nuevo sin source pero con referrer -> persiste el hostname', async () => {
        prisma.patient.findMany.mockResolvedValue([]);
        prisma.patient.findFirst.mockResolvedValue(null);
        prisma.patient.create.mockResolvedValue(buildPatient());

        await service.resolveForPublicBooking('therapist-1', dto as never, {
          referrer: 'https://www.instagram.com/reel/xyz',
        });

        expect(prisma.patient.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            acquisitionSource: 'www.instagram.com',
            acquisitionReferrer: 'https://www.instagram.com/reel/xyz',
          }) as unknown,
        });
      });

      it('paciente nuevo sin source ni referrer -> "directo"', async () => {
        prisma.patient.findMany.mockResolvedValue([]);
        prisma.patient.findFirst.mockResolvedValue(null);
        prisma.patient.create.mockResolvedValue(buildPatient());

        await service.resolveForPublicBooking('therapist-1', dto as never);

        expect(prisma.patient.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            acquisitionSource: 'directo',
            acquisitionReferrer: null,
          }) as unknown,
        });
      });

      it('paciente EXISTENTE (match por email) -> no toca los campos de acquisition', async () => {
        const existing = buildPatient({ email: 'paciente@ejemplo.cl' });
        prisma.patient.findMany.mockResolvedValue([existing]);

        const result = await service.resolveForPublicBooking(
          'therapist-1',
          dto as never,
          { source: 'google' },
        );

        expect(result).toEqual({ patient: existing, isNew: false });
        expect(prisma.patient.create).not.toHaveBeenCalled();
        expect(prisma.patient.update).not.toHaveBeenCalled();
      });
    });
  });

  // issue #157: agregación en backend (mismo criterio que getStats en
  // consultations.service.ts, issue #40).
  describe('getAcquisitionStats', () => {
    it('agrupa por acquisitionSource, mapea null a "directo" y ordena desc', async () => {
      prisma.patient.groupBy.mockResolvedValue([
        { acquisitionSource: 'google', _count: 3 },
        { acquisitionSource: null, _count: 5 },
        { acquisitionSource: 'instagram.com', _count: 1 },
      ]);

      const result = await service.getAcquisitionStats('therapist-1');

      expect(prisma.patient.groupBy).toHaveBeenCalledWith({
        by: ['acquisitionSource'],
        where: { therapistId: 'therapist-1', deletedAt: null },
        _count: true,
      });
      expect(result).toEqual([
        { source: 'directo', count: 5 },
        { source: 'google', count: 3 },
        { source: 'instagram.com', count: 1 },
      ]);
    });
  });
});
