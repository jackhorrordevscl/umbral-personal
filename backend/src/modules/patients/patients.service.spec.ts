import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Patient, Prisma } from '@prisma/client';
import { PatientsService, computeMinorStatus } from './patients.service';
import { MINOR_GUARDIAN_ENFORCEMENT_DATE } from './patients.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import { PaymentsService } from '../payments/payments.service';
import { AvailabilityService } from '../availability/availability.service';
import { UNPAGINATED_SAFETY_LIMIT } from '../../common/dto/pagination.dto';
import { DEFAULT_PATIENTS_PAGE_SIZE } from './dto/patients-query.dto';

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
    // Relación incluida por findOne/findAll (M2a); los demás métodos la ignoran.
    guardians: [],
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
      findUnique: jest.Mock;
      update: jest.Mock;
      groupBy: jest.Mock;
    };
    legalGuardian: {
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
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
        findUnique: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn(),
      },
      legalGuardian: {
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
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
    // issue #290: la respuesta siempre es { data, total, page, pageSize }; sin
    // page/pageSize se aplica un tamaño por defecto, nunca un corte silencioso.
    it('sin pagination devuelve la forma paginada con defaults y consents agregados', async () => {
      prisma.patient.findMany.mockResolvedValue([buildPatient()]);
      prisma.patient.count.mockResolvedValue(1);
      prisma.patientConsent.findMany.mockResolvedValue([]);

      const result = await service.findAll('therapist-1');

      expect(result).toEqual({
        data: [
          expect.objectContaining({
            consents: { TREATMENT: false, TELEMEDICINE: false },
          }),
        ],
        total: 1,
        page: 1,
        pageSize: DEFAULT_PATIENTS_PAGE_SIZE,
      });
      expect(prisma.patient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: DEFAULT_PATIENTS_PAGE_SIZE, skip: 0 }),
      );
    });

    it('con page/pageSize pagina con take/skip y devuelve total', async () => {
      prisma.patient.findMany.mockResolvedValue([buildPatient()]);
      prisma.patient.count.mockResolvedValue(21);
      prisma.patientConsent.findMany.mockResolvedValue([]);

      const result = await service.findAll('therapist-1', {
        page: 2,
        pageSize: 10,
      });

      expect(prisma.patient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 10 }),
      );
      expect(result).toEqual(
        expect.objectContaining({ total: 21, page: 2, pageSize: 10 }),
      );
    });

    it('search filtra por nombre y RUT (insensible a mayúsculas) y el total usa el mismo filtro', async () => {
      prisma.patient.findMany.mockResolvedValue([]);
      prisma.patient.count.mockResolvedValue(0);
      prisma.patientConsent.findMany.mockResolvedValue([]);

      await service.findAll('therapist-1', { search: '  12.345.678-k ' });

      const expectedWhere = {
        therapistId: 'therapist-1',
        deletedAt: null,
        OR: [
          { fullName: { contains: '12.345.678-k', mode: 'insensitive' } },
          { rut: { contains: '12345678-K' } },
        ],
      };
      expect(prisma.patient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prisma.patient.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('search vacío o solo espacios no agrega filtro', async () => {
      prisma.patient.findMany.mockResolvedValue([]);
      prisma.patient.count.mockResolvedValue(0);
      prisma.patientConsent.findMany.mockResolvedValue([]);

      await service.findAll('therapist-1', { search: '   ' });

      expect(prisma.patient.count).toHaveBeenCalledWith({
        where: { therapistId: 'therapist-1', deletedAt: null },
      });
    });
  });

  describe('getSummary', () => {
    it('devuelve total y withConsent acotados al terapeuta', async () => {
      prisma.patient.count.mockResolvedValue(7);
      prisma.$queryRaw.mockResolvedValue([{ count: BigInt(3) }]);

      const result = await service.getSummary('therapist-1');

      expect(result).toEqual({ total: 7, withConsent: 3 });
      expect(prisma.patient.count).toHaveBeenCalledWith({
        where: { therapistId: 'therapist-1', deletedAt: null },
      });
    });
  });

  describe('assertAccess', () => {
    it('lanza 404 si el paciente no existe o no pertenece al terapeuta', async () => {
      prisma.patient.findFirst.mockResolvedValue(null);

      await expect(
        service.assertAccess('patient-1', 'therapist-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('devuelve { id, rut, birthDate } si el paciente pertenece al terapeuta', async () => {
      const birthDate = new Date('1990-01-01');
      prisma.patient.findFirst.mockResolvedValue({
        id: 'patient-1',
        rut: '11111111-1',
        birthDate,
      });

      const result = await service.assertAccess('patient-1', 'therapist-1');

      expect(result).toEqual({
        id: 'patient-1',
        rut: '11111111-1',
        birthDate,
      });
    });
  });

  describe('findOne', () => {
    it('lanza 404 si el paciente no existe', async () => {
      prisma.patient.findFirst.mockResolvedValue(null);

      await expect(service.findOne('patient-1', 'therapist-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('acota los documentos con el cap de seguridad (issue #290)', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());

      await service.findOne('patient-1', 'therapist-1');

      expect(prisma.patient.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            documents: {
              orderBy: { uploadedAt: 'desc' },
              take: UNPAGINATED_SAFETY_LIMIT,
            },
          }) as unknown,
        }),
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

  // M2a: edad, tramo y estado de regularización de menores. El estado se deriva
  // del último evento por (paciente, finalidad) y de los representantes con
  // canConsent; los listados lo calculan en una sola consulta por página.
  describe('campos de menor de edad', () => {
    const yearsAgo = (years: number) => {
      const date = new Date();
      date.setUTCFullYear(date.getUTCFullYear() - years);
      return date;
    };
    const consentEvent = (
      patientId: string,
      purpose: 'TREATMENT' | 'TELEMEDICINE',
      action: 'GRANT' | 'REVOKE',
      grantedBy: 'PATIENT' | 'GUARDIAN',
    ) => ({ patientId, purpose, action, grantedBy });

    describe('computeMinorStatus', () => {
      const adult = yearsAgo(30);
      const minor = yearsAgo(10);

      it('NOT_MINOR para un adulto, tenga o no representantes', () => {
        expect(computeMinorStatus(adult, 0, [])).toBe('NOT_MINOR');
        expect(
          computeMinorStatus(adult, 1, [
            consentEvent('p', 'TREATMENT', 'GRANT', 'PATIENT'),
          ]),
        ).toBe('NOT_MINOR');
      });

      it('MISSING_GUARDIAN para un menor sin representante con canConsent', () => {
        expect(computeMinorStatus(minor, 0, [])).toBe('MISSING_GUARDIAN');
      });

      it('LEGACY_CONSENT si el consentimiento vigente lo otorgó el paciente', () => {
        expect(
          computeMinorStatus(minor, 1, [
            consentEvent('p', 'TREATMENT', 'GRANT', 'PATIENT'),
          ]),
        ).toBe('LEGACY_CONSENT');
      });

      it('LEGACY_CONSENT si basta con una finalidad vigente otorgada por el paciente', () => {
        expect(
          computeMinorStatus(minor, 1, [
            consentEvent('p', 'TREATMENT', 'GRANT', 'GUARDIAN'),
            consentEvent('p', 'TELEMEDICINE', 'GRANT', 'PATIENT'),
          ]),
        ).toBe('LEGACY_CONSENT');
      });

      it('OK si todo consentimiento vigente lo otorgó un representante', () => {
        expect(
          computeMinorStatus(minor, 1, [
            consentEvent('p', 'TREATMENT', 'GRANT', 'GUARDIAN'),
          ]),
        ).toBe('OK');
      });

      it('OK si no hay ningún consentimiento vigente (nada que regularizar)', () => {
        expect(computeMinorStatus(minor, 1, [])).toBe('OK');
      });

      it('ignora un consentimiento legado ya revocado', () => {
        expect(
          computeMinorStatus(minor, 1, [
            consentEvent('p', 'TREATMENT', 'REVOKE', 'PATIENT'),
          ]),
        ).toBe('OK');
      });
    });

    describe('findOne', () => {
      it('para un menor expone isMinor, ageBand, guardians, minorStatus y la fecha de vigencia', async () => {
        const guardian = { id: 'g-1', canConsent: true };
        prisma.patient.findFirst.mockResolvedValue({
          ...buildPatient({ birthDate: yearsAgo(10) }),
          guardians: [guardian],
        });
        prisma.patientConsent.findMany.mockResolvedValue([
          consentEvent('patient-1', 'TREATMENT', 'GRANT', 'PATIENT'),
        ]);

        const result = await service.findOne('patient-1', 'therapist-1');

        expect(result).toEqual(
          expect.objectContaining({
            isMinor: true,
            ageBand: 'UNDER_14',
            guardians: [guardian],
            guardianCount: 1,
            minorStatus: 'LEGACY_CONSENT',
            guardianEnforcementDate: MINOR_GUARDIAN_ENFORCEMENT_DATE,
          }),
        );
      });

      it('incluye los representantes ordenados por createdAt', async () => {
        prisma.patient.findFirst.mockResolvedValue({
          ...buildPatient(),
          guardians: [],
        });

        await service.findOne('patient-1', 'therapist-1');

        expect(prisma.patient.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            include: expect.objectContaining({
              guardians: { orderBy: { createdAt: 'asc' } },
            }) as unknown,
          }),
        );
      });

      it('para un adulto no incluye la fecha de vigencia y marca ADULT', async () => {
        prisma.patient.findFirst.mockResolvedValue({
          ...buildPatient({ birthDate: yearsAgo(30) }),
          guardians: [],
        });

        const result = await service.findOne('patient-1', 'therapist-1');

        expect(result).toEqual(
          expect.objectContaining({
            isMinor: false,
            ageBand: 'ADULT',
            minorStatus: 'NOT_MINOR',
          }),
        );
        expect(result).not.toHaveProperty('guardianEnforcementDate');
      });

      it('consulta los consentimientos una sola vez', async () => {
        prisma.patient.findFirst.mockResolvedValue({
          ...buildPatient(),
          guardians: [],
        });

        await service.findOne('patient-1', 'therapist-1');

        expect(prisma.patientConsent.findMany).toHaveBeenCalledTimes(1);
      });
    });

    describe('findAll', () => {
      it('devuelve guardianCount y minorStatus sin incluir la lista de representantes', async () => {
        prisma.patient.findMany.mockResolvedValue([
          {
            ...buildPatient({ id: 'minor-ok', birthDate: yearsAgo(15) }),
            guardians: [{ canConsent: true }, { canConsent: false }],
          },
          {
            ...buildPatient({ id: 'minor-missing', birthDate: yearsAgo(5) }),
            guardians: [{ canConsent: false }],
          },
          {
            ...buildPatient({ id: 'adult', birthDate: yearsAgo(40) }),
            guardians: [],
          },
        ]);
        prisma.patient.count.mockResolvedValue(3);
        prisma.patientConsent.findMany.mockResolvedValue([
          consentEvent('minor-ok', 'TREATMENT', 'GRANT', 'GUARDIAN'),
        ]);

        const result = await service.findAll('therapist-1');

        const byId = Object.fromEntries(result.data.map((p) => [p.id, p]));
        expect(byId['minor-ok']).toEqual(
          expect.objectContaining({
            isMinor: true,
            ageBand: 'AGE_14_17',
            guardianCount: 2,
            minorStatus: 'OK',
            guardianEnforcementDate: MINOR_GUARDIAN_ENFORCEMENT_DATE,
          }),
        );
        expect(byId['minor-missing']).toEqual(
          expect.objectContaining({
            ageBand: 'UNDER_14',
            minorStatus: 'MISSING_GUARDIAN',
          }),
        );
        expect(byId['adult']).toEqual(
          expect.objectContaining({
            isMinor: false,
            ageBand: 'ADULT',
            guardianCount: 0,
            minorStatus: 'NOT_MINOR',
          }),
        );
        expect(byId['minor-ok']).not.toHaveProperty('guardians');
      });

      it('resuelve consentimientos y representantes sin consultas por paciente', async () => {
        prisma.patient.findMany.mockResolvedValue([
          { ...buildPatient({ id: 'a' }), guardians: [] },
          { ...buildPatient({ id: 'b' }), guardians: [] },
        ]);
        prisma.patient.count.mockResolvedValue(2);
        prisma.patientConsent.findMany.mockResolvedValue([]);

        await service.findAll('therapist-1');

        expect(prisma.patient.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.patientConsent.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.patient.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            include: { guardians: { select: { canConsent: true } } },
          }),
        );
      });
    });

    describe('getConsentStatusMap', () => {
      it('conserva su firma y su resultado booleano por finalidad', async () => {
        prisma.patientConsent.findMany.mockResolvedValue([
          consentEvent('patient-1', 'TREATMENT', 'GRANT', 'GUARDIAN'),
        ]);

        const map = await service.getConsentStatusMap(['patient-1']);

        expect(map.get('patient-1')).toEqual({
          TREATMENT: true,
          TELEMEDICINE: false,
        });
      });
    });
  });

  describe('update', () => {
    it('lee solo columnas escalares del paciente (sin consultas, documentos ni consentimientos) (issue #290)', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());

      await service.update(
        'patient-1',
        { fullName: 'Paciente de Prueba', reason: 'Sin cambios' } as never,
        'therapist-1',
      );

      expect(prisma.patient.findFirst).toHaveBeenCalledWith({
        where: { id: 'patient-1', therapistId: 'therapist-1', deletedAt: null },
      });
      expect(prisma.patientConsent.findMany).not.toHaveBeenCalled();
    });

    it('lanza 404 si el paciente no existe o es de otro terapeuta', async () => {
      prisma.patient.findFirst.mockResolvedValue(null);

      await expect(
        service.update(
          'patient-1',
          { fullName: 'X', reason: 'Motivo cualquiera' } as never,
          'therapist-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.patient.update).not.toHaveBeenCalled();
    });

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

    it('ficha con DV inválido guardado: reenviar el mismo RUT no bloquea la edición (issue #289)', async () => {
      prisma.patient.findFirst.mockResolvedValue(
        buildPatient({ rut: '11111111-2' }),
      );
      prisma.patientConsent.findMany.mockResolvedValue([]);
      prisma.patient.update.mockResolvedValue(buildPatient());

      await service.update(
        'patient-1',
        {
          rut: '11.111.111-2',
          fullName: 'Nombre Actualizado',
          reason: 'Corrección del nombre del paciente',
        } as never,
        'therapist-1',
      );

      expect(prisma.patient.update).toHaveBeenCalledTimes(1);
    });

    it('cambiar el RUT a uno con DV inválido responde 400 y no escribe (issue #289)', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patientConsent.findMany.mockResolvedValue([]);

      await expect(
        service.update(
          'patient-1',
          {
            rut: '22222222-3',
            reason: 'RUT ingresado con error de tipeo',
          } as never,
          'therapist-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.patient.update).not.toHaveBeenCalled();
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

  // M2b: escritura estricta del consentimiento según la edad del paciente.
  describe('recordConsent (menores y representantes)', () => {
    const consentDto = (extra: Record<string, unknown> = {}) =>
      ({
        purpose: 'TREATMENT',
        action: 'GRANT',
        evidence: 'Firmado en papel, escaneado y adjunto al expediente',
        ...extra,
      }) as never;
    const minor = () => buildPatient({ birthDate: new Date('2015-01-01') });
    const GUARDIAN_ID = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-08T15:00:00Z'));
      prisma.patientConsent.create.mockResolvedValue({ id: 'consent-1' });
    });
    afterEach(() => jest.useRealTimers());

    it('adulto: persiste grantedBy PATIENT y guardianId null por defecto', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());

      await service.recordConsent('patient-1', consentDto(), 'therapist-1');

      expect(prisma.patientConsent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          grantedBy: 'PATIENT',
          guardianId: null,
        }) as unknown,
      });
    });

    it('adulto: rechaza un otorgante GUARDIAN con 400', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());

      await expect(
        service.recordConsent(
          'patient-1',
          consentDto({ grantedBy: 'GUARDIAN', guardianId: GUARDIAN_ID }),
          'therapist-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.patientConsent.create).not.toHaveBeenCalled();
    });

    it('adulto: rechaza un guardianId aunque venga con grantedBy PATIENT', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());

      await expect(
        service.recordConsent(
          'patient-1',
          consentDto({ grantedBy: 'PATIENT', guardianId: GUARDIAN_ID }),
          'therapist-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('menor: rechaza un GRANT sin representante con 400', async () => {
      prisma.patient.findFirst.mockResolvedValue(minor());

      await expect(
        service.recordConsent('patient-1', consentDto(), 'therapist-1'),
      ).rejects.toThrow(/representante legal/);
      expect(prisma.patientConsent.create).not.toHaveBeenCalled();
    });

    it('menor: rechaza un GRANT con grantedBy GUARDIAN pero sin guardianId', async () => {
      prisma.patient.findFirst.mockResolvedValue(minor());

      await expect(
        service.recordConsent(
          'patient-1',
          consentDto({ grantedBy: 'GUARDIAN' }),
          'therapist-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('menor: rechaza un representante de otro paciente (404 de la consulta acotada)', async () => {
      prisma.patient.findFirst.mockResolvedValue(minor());
      prisma.legalGuardian.findFirst.mockResolvedValue(null);

      await expect(
        service.recordConsent(
          'patient-1',
          consentDto({ grantedBy: 'GUARDIAN', guardianId: GUARDIAN_ID }),
          'therapist-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.legalGuardian.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: GUARDIAN_ID, patientId: 'patient-1' },
        }),
      );
      expect(prisma.patientConsent.create).not.toHaveBeenCalled();
    });

    it('menor: rechaza un representante con canConsent false', async () => {
      prisma.patient.findFirst.mockResolvedValue(minor());
      prisma.legalGuardian.findFirst.mockResolvedValue({ canConsent: false });

      await expect(
        service.recordConsent(
          'patient-1',
          consentDto({ grantedBy: 'GUARDIAN', guardianId: GUARDIAN_ID }),
          'therapist-1',
        ),
      ).rejects.toThrow(/habilitado/);
    });

    it('menor: acepta un GRANT de un representante habilitado y persiste grantedBy/guardianId', async () => {
      prisma.patient.findFirst.mockResolvedValue(minor());
      prisma.legalGuardian.findFirst.mockResolvedValue({ canConsent: true });

      await service.recordConsent(
        'patient-1',
        consentDto({ grantedBy: 'GUARDIAN', guardianId: GUARDIAN_ID }),
        'therapist-1',
      );

      expect(prisma.patientConsent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          grantedBy: 'GUARDIAN',
          guardianId: GUARDIAN_ID,
        }) as unknown,
      });
    });

    it('menor: si el representante se elimina antes del INSERT (FK P2003) responde 400, no 500', async () => {
      prisma.patient.findFirst.mockResolvedValue(minor());
      prisma.legalGuardian.findFirst.mockResolvedValue({ canConsent: true });
      prisma.patientConsent.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('FK violation', {
          code: 'P2003',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.recordConsent(
          'patient-1',
          consentDto({ grantedBy: 'GUARDIAN', guardianId: GUARDIAN_ID }),
          'therapist-1',
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'El representante indicado no pertenece a este paciente.',
        ),
      );
    });

    it('un error de base de datos distinto de P2003 se propaga', async () => {
      prisma.patient.findFirst.mockResolvedValue(buildPatient());
      prisma.patientConsent.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.recordConsent('patient-1', consentDto(), 'therapist-1'),
      ).rejects.toThrow('db down');
    });

    it('menor: un REVOKE se acepta sin representante', async () => {
      prisma.patient.findFirst.mockResolvedValue(minor());

      await service.recordConsent(
        'patient-1',
        consentDto({ action: 'REVOKE' }),
        'therapist-1',
      );

      expect(prisma.patientConsent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'REVOKE',
          grantedBy: 'PATIENT',
          guardianId: null,
        }) as unknown,
      });
    });

    it('menor: un REVOKE con representante exige que sea del paciente', async () => {
      prisma.patient.findFirst.mockResolvedValue(minor());
      prisma.legalGuardian.findFirst.mockResolvedValue(null);

      await expect(
        service.recordConsent(
          'patient-1',
          consentDto({
            action: 'REVOKE',
            grantedBy: 'GUARDIAN',
            guardianId: GUARDIAN_ID,
          }),
          'therapist-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('bulkDeclareConsent omite a los menores con la razón y sigue con los adultos', async () => {
      prisma.patient.findFirst
        .mockResolvedValueOnce(minor())
        .mockResolvedValueOnce(buildPatient({ id: 'patient-2' }));

      const results = await service.bulkDeclareConsent(
        {
          patientIds: ['patient-1', 'patient-2'],
          purpose: 'TREATMENT',
          evidence: 'Consentimiento en papel del expediente físico previo',
        } as never,
        'therapist-1',
      );

      expect(prisma.patientConsent.create).toHaveBeenCalledTimes(1);
      expect(results).toEqual([
        {
          patientId: 'patient-1',
          ok: false,
          error: expect.stringContaining('representante legal') as unknown,
        },
        { patientId: 'patient-2', ok: true },
      ]);
    });
  });

  // M2b: política de lectura suave para el guardrail de consultas.
  describe('assertTreatmentConsent', () => {
    const MESSAGE = 'Sin consentimiento vigente';
    const event = (
      action: 'GRANT' | 'REVOKE',
      grantedBy: 'PATIENT' | 'GUARDIAN',
      purpose: 'TREATMENT' | 'TELEMEDICINE' = 'TREATMENT',
    ) => ({ patientId: 'patient-1', purpose, action, grantedBy });
    const withBirth = (birthDate: string) =>
      prisma.patient.findUnique.mockResolvedValue({
        birthDate: new Date(birthDate),
      });
    const BEFORE = new Date('2026-11-30T12:00:00Z');
    const AFTER = new Date('2026-12-01T12:00:00Z');

    afterEach(() => jest.useRealTimers());

    it('adulto: sin consentimiento vigente da 403 con el mensaje recibido', async () => {
      withBirth('1990-01-01');

      await expect(
        service.assertTreatmentConsent('patient-1', MESSAGE),
      ).rejects.toThrow(new ForbiddenException(MESSAGE));
    });

    it('adulto: un REVOKE vigente cuenta como sin consentimiento', async () => {
      withBirth('1990-01-01');
      prisma.patientConsent.findMany.mockResolvedValue([
        event('REVOKE', 'PATIENT'),
      ]);

      await expect(
        service.assertTreatmentConsent('patient-1', MESSAGE),
      ).rejects.toThrow(ForbiddenException);
    });

    it('adulto: acepta cualquier finalidad otorgada por el paciente', async () => {
      withBirth('1990-01-01');
      prisma.patientConsent.findMany.mockResolvedValue([
        event('GRANT', 'PATIENT', 'TELEMEDICINE'),
      ]);

      await expect(
        service.assertTreatmentConsent('patient-1', MESSAGE),
      ).resolves.toBeUndefined();
    });

    it('adulto: la fecha de vigencia no cambia nada', async () => {
      jest.useFakeTimers().setSystemTime(AFTER);
      withBirth('1990-01-01');
      prisma.patientConsent.findMany.mockResolvedValue([
        event('GRANT', 'PATIENT'),
      ]);

      await expect(
        service.assertTreatmentConsent('patient-1', MESSAGE),
      ).resolves.toBeUndefined();
    });

    it('menor antes de la fecha: el consentimiento legado del paciente sigue valiendo', async () => {
      jest.useFakeTimers().setSystemTime(BEFORE);
      withBirth('2015-01-01');
      prisma.patientConsent.findMany.mockResolvedValue([
        event('GRANT', 'PATIENT'),
      ]);

      await expect(
        service.assertTreatmentConsent('patient-1', MESSAGE),
      ).resolves.toBeUndefined();
    });

    it('menor antes de la fecha: sin consentimiento da 403 genérico', async () => {
      jest.useFakeTimers().setSystemTime(BEFORE);
      withBirth('2015-01-01');

      await expect(
        service.assertTreatmentConsent('patient-1', MESSAGE),
      ).rejects.toThrow(new ForbiddenException(MESSAGE));
    });

    it('menor desde la fecha: un consentimiento legado da 403 específico', async () => {
      jest.useFakeTimers().setSystemTime(AFTER);
      withBirth('2015-01-01');
      prisma.patientConsent.findMany.mockResolvedValue([
        event('GRANT', 'PATIENT'),
      ]);

      await expect(
        service.assertTreatmentConsent('patient-1', MESSAGE),
      ).rejects.toThrow(/menor de edad.*representante legal/);
    });

    it('menor desde la fecha: sin consentimiento mantiene el mensaje genérico', async () => {
      jest.useFakeTimers().setSystemTime(AFTER);
      withBirth('2015-01-01');

      await expect(
        service.assertTreatmentConsent('patient-1', MESSAGE),
      ).rejects.toThrow(new ForbiddenException(MESSAGE));
    });

    it('menor desde la fecha: un propósito legado junto a otro del representante da 403 (como LEGACY_CONSENT)', async () => {
      jest.useFakeTimers().setSystemTime(AFTER);
      withBirth('2015-01-01');
      prisma.legalGuardian.count.mockResolvedValue(1);
      prisma.patientConsent.findMany.mockResolvedValue([
        event('GRANT', 'PATIENT', 'TREATMENT'),
        event('GRANT', 'GUARDIAN', 'TELEMEDICINE'),
      ]);

      await expect(
        service.assertTreatmentConsent('patient-1', MESSAGE),
      ).rejects.toThrow(/Registra al representante y un nuevo consentimiento/);
    });

    it('menor desde la fecha: acepta si todos los GRANT vigentes son del representante', async () => {
      jest.useFakeTimers().setSystemTime(AFTER);
      withBirth('2015-01-01');
      prisma.legalGuardian.count.mockResolvedValue(1);
      prisma.patientConsent.findMany.mockResolvedValue([
        event('GRANT', 'GUARDIAN', 'TREATMENT'),
        event('GRANT', 'GUARDIAN', 'TELEMEDICINE'),
      ]);

      await expect(
        service.assertTreatmentConsent('patient-1', MESSAGE),
      ).resolves.toBeUndefined();
      expect(prisma.legalGuardian.count).toHaveBeenCalledWith({
        where: { patientId: 'patient-1', canConsent: true },
      });
    });

    it('menor desde la fecha: sin representante con canConsent da 403 aunque el GRANT sea de un representante', async () => {
      jest.useFakeTimers().setSystemTime(AFTER);
      withBirth('2015-01-01');
      prisma.legalGuardian.count.mockResolvedValue(0);
      prisma.patientConsent.findMany.mockResolvedValue([
        event('GRANT', 'GUARDIAN'),
      ]);

      await expect(
        service.assertTreatmentConsent('patient-1', MESSAGE),
      ).rejects.toThrow(/Registra al representante e indícalo/);
    });

    it('menor antes de la fecha: un GRANT legado pasa sin consultar representantes', async () => {
      jest.useFakeTimers().setSystemTime(BEFORE);
      withBirth('2015-01-01');
      prisma.patientConsent.findMany.mockResolvedValue([
        event('GRANT', 'PATIENT', 'TREATMENT'),
        event('GRANT', 'GUARDIAN', 'TELEMEDICINE'),
      ]);

      await expect(
        service.assertTreatmentConsent('patient-1', MESSAGE),
      ).resolves.toBeUndefined();
      expect(prisma.legalGuardian.count).not.toHaveBeenCalled();
    });

    it('usa el día calendario de Santiago para la fecha de vigencia', async () => {
      // 2026-12-01T02:00Z sigue siendo 30-nov en Santiago (UTC-3 en verano).
      jest.useFakeTimers().setSystemTime(new Date('2026-12-01T02:00:00Z'));
      withBirth('2015-01-01');
      prisma.patientConsent.findMany.mockResolvedValue([
        event('GRANT', 'PATIENT'),
      ]);

      await expect(
        service.assertTreatmentConsent('patient-1', MESSAGE),
      ).resolves.toBeUndefined();
    });

    it('lee con el cliente de transacción recibido', async () => {
      withBirth('1990-01-01');
      prisma.patientConsent.findMany.mockResolvedValue([
        event('GRANT', 'PATIENT'),
      ]);
      const tx = {
        patient: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ birthDate: new Date('1990-01-01') }),
        },
        patientConsent: {
          findMany: jest.fn().mockResolvedValue([event('GRANT', 'PATIENT')]),
        },
      };

      await service.assertTreatmentConsent(
        'patient-1',
        MESSAGE,
        tx as unknown as PrismaService,
      );

      expect(tx.patient.findUnique).toHaveBeenCalled();
      expect(tx.patientConsent.findMany).toHaveBeenCalled();
      expect(prisma.patientConsent.findMany).not.toHaveBeenCalled();
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

    it('ficha existente con DV inválido guardado: el paciente puede autoagendarse con ese RUT (issue #289)', async () => {
      const existing = buildPatient({
        email: 'paciente@ejemplo.cl',
        rut: '11111111-2',
      });
      prisma.patient.findMany.mockResolvedValue([existing]);

      const result = await service.resolveForPublicBooking('therapist-1', {
        ...dto,
        rut: '11.111.111-2',
      } as never);

      expect(result).toEqual({ patient: existing, isNew: false });
    });

    it('paciente nuevo con DV inválido -> 409 uniforme y no crea la ficha (issue #289)', async () => {
      prisma.patient.findMany.mockResolvedValue([]);

      const attempt = service.resolveForPublicBooking('therapist-1', {
        ...dto,
        rut: '11.111.111-2',
      } as never);

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.patient.create).not.toHaveBeenCalled();
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

    // Minor booking: the server decides minor-ness from the submitted
    // birthDate; identity is the patient RUT scoped to the therapist plus a
    // matching guardian RUT. Birth dates are relative to today (no time bomb).
    describe('minor booking', () => {
      const yearsAgo = (years: number): string => {
        const date = new Date();
        date.setUTCFullYear(date.getUTCFullYear() - years);
        return date.toISOString().slice(0, 10);
      };
      const minorDto = {
        fullName: 'Paciente Menor',
        rut: '11.111.111-1',
        birthDate: yearsAgo(10),
      };
      const guardian = {
        fullName: 'Representante Legal',
        rut: '12.345.678-5',
        relationship: 'MOTHER',
        email: 'Madre@Ejemplo.cl',
        phone: '+56911111111',
      };

      it('adulto sin email -> 400 y no toca la base', async () => {
        const { email: _email, ...withoutEmail } = dto;

        await expect(
          service.resolveForPublicBooking(
            'therapist-1',
            withoutEmail as never,
            undefined,
            undefined,
            undefined,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.patient.findMany).not.toHaveBeenCalled();
        expect(prisma.patient.create).not.toHaveBeenCalled();
      });

      it('adulto con representante -> 400', async () => {
        await expect(
          service.resolveForPublicBooking(
            'therapist-1',
            dto as never,
            undefined,
            undefined,
            guardian as never,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.patient.create).not.toHaveBeenCalled();
      });

      it('menor sin representante -> 400', async () => {
        await expect(
          service.resolveForPublicBooking('therapist-1', minorDto as never),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.patient.findFirst).not.toHaveBeenCalled();
        expect(prisma.patient.create).not.toHaveBeenCalled();
      });

      it('menor nuevo: crea la ficha (email null) y un representante pagador en el mismo client', async () => {
        prisma.patient.findFirst.mockResolvedValue(null);
        const created = buildPatient({
          id: 'minor-1',
          rut: '11111111-1',
          email: null,
        });
        prisma.patient.create.mockResolvedValue(created);
        prisma.legalGuardian.create.mockResolvedValue({ id: 'guardian-1' });

        const result = await service.resolveForPublicBooking(
          'therapist-1',
          minorDto as never,
          { source: 'instagram' },
          undefined,
          guardian as never,
        );

        expect(result).toEqual({ patient: created, isNew: true });
        // Adult email-first lookup is never used for minors.
        expect(prisma.patient.findMany).not.toHaveBeenCalled();
        expect(prisma.patient.findFirst).toHaveBeenCalledWith({
          where: {
            therapistId: 'therapist-1',
            rut: '11111111-1',
            deletedAt: null,
          },
        });
        expect(prisma.patient.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            rut: '11111111-1',
            email: null,
            therapistId: 'therapist-1',
            acquisitionSource: 'instagram',
          }) as unknown,
        });
        expect(prisma.legalGuardian.create).toHaveBeenCalledWith({
          data: {
            patientId: 'minor-1',
            fullName: 'Representante Legal',
            rut: '12345678-5',
            relationship: 'MOTHER',
            email: 'madre@ejemplo.cl',
            phone: '+56911111111',
            isPayer: true,
            receivesCommunications: true,
            canAccessReports: true,
            canConsent: true,
            custody: 'UNKNOWN',
            hasConflict: false,
          },
        });
      });

      it('menor nuevo con email propio: lo guarda normalizado', async () => {
        prisma.patient.findFirst.mockResolvedValue(null);
        prisma.patient.create.mockResolvedValue(buildPatient({ id: 'm-2' }));
        prisma.legalGuardian.create.mockResolvedValue({ id: 'g-2' });

        await service.resolveForPublicBooking(
          'therapist-1',
          { ...minorDto, email: ' Menor@Ejemplo.cl ' } as never,
          undefined,
          undefined,
          { ...guardian, phone: undefined } as never,
        );

        const createArgs = prisma.patient.create.mock.calls[0] as unknown[];
        expect((createArgs[0] as { data: { email: string } }).data.email).toBe(
          'menor@ejemplo.cl',
        );
        const guardianArgs = prisma.legalGuardian.create.mock
          .calls[0] as unknown[];
        expect(
          (guardianArgs[0] as { data: { phone: unknown } }).data.phone,
        ).toBeNull();
      });

      it('menor existente con un representante del mismo RUT: reutiliza la ficha sin escribir', async () => {
        const existing = buildPatient({ id: 'minor-1', rut: '11111111-1' });
        prisma.patient.findFirst.mockResolvedValue(existing);
        prisma.legalGuardian.findFirst.mockResolvedValue({ id: 'guardian-1' });

        const result = await service.resolveForPublicBooking(
          'therapist-1',
          { ...minorDto, rut: '11111111-1' } as never,
          undefined,
          undefined,
          { ...guardian, rut: '12345678-5' } as never,
        );

        expect(result).toEqual({ patient: existing, isNew: false });
        expect(prisma.legalGuardian.findFirst).toHaveBeenCalledWith({
          where: { patientId: 'minor-1', rut: '12345678-5' },
          select: { id: true },
        });
        expect(prisma.patient.create).not.toHaveBeenCalled();
        expect(prisma.patient.update).not.toHaveBeenCalled();
        expect(prisma.legalGuardian.create).not.toHaveBeenCalled();
      });

      it('menor existente sin un representante con ese RUT -> 409 uniforme, sin escribir', async () => {
        prisma.patient.findFirst.mockResolvedValue(
          buildPatient({ id: 'minor-1', rut: '11111111-1' }),
        );
        prisma.legalGuardian.findFirst.mockResolvedValue(null);

        const attempt = service.resolveForPublicBooking(
          'therapist-1',
          minorDto as never,
          undefined,
          undefined,
          guardian as never,
        );

        await expect(attempt).rejects.toThrow(ConflictException);
        await expect(attempt).rejects.toThrow(
          'No fue posible procesar la reserva.',
        );
        expect(prisma.patient.create).not.toHaveBeenCalled();
        expect(prisma.legalGuardian.create).not.toHaveBeenCalled();
      });

      it('RUT del menor con DV inválido -> 409 uniforme, sin buscar ni crear', async () => {
        await expect(
          service.resolveForPublicBooking(
            'therapist-1',
            { ...minorDto, rut: '11.111.111-2' } as never,
            undefined,
            undefined,
            guardian as never,
          ),
        ).rejects.toThrow('No fue posible procesar la reserva.');
        expect(prisma.patient.findFirst).not.toHaveBeenCalled();
        expect(prisma.patient.create).not.toHaveBeenCalled();
      });

      it('RUT del representante con DV inválido -> 409 uniforme, sin buscar ni crear', async () => {
        await expect(
          service.resolveForPublicBooking(
            'therapist-1',
            minorDto as never,
            undefined,
            undefined,
            { ...guardian, rut: '12.345.678-9' } as never,
          ),
        ).rejects.toThrow(ConflictException);
        expect(prisma.patient.findFirst).not.toHaveBeenCalled();
        expect(prisma.patient.create).not.toHaveBeenCalled();
      });

      it('carrera al crear el menor: P2002 -> 409 uniforme', async () => {
        prisma.patient.findFirst.mockResolvedValue(null);
        prisma.patient.create.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        );

        await expect(
          service.resolveForPublicBooking(
            'therapist-1',
            minorDto as never,
            undefined,
            undefined,
            guardian as never,
          ),
        ).rejects.toThrow(ConflictException);
        expect(prisma.legalGuardian.create).not.toHaveBeenCalled();
      });

      it('usa el client transaccional recibido para la ficha y el representante', async () => {
        const tx = {
          patient: {
            findMany: jest.fn(),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(buildPatient({ id: 'm-3' })),
          },
          legalGuardian: {
            findFirst: jest.fn(),
            create: jest.fn().mockResolvedValue({ id: 'g-3' }),
          },
        };

        await service.resolveForPublicBooking(
          'therapist-1',
          minorDto as never,
          undefined,
          tx as never,
          guardian as never,
        );

        expect(tx.patient.create).toHaveBeenCalled();
        expect(tx.legalGuardian.create).toHaveBeenCalled();
        expect(prisma.patient.create).not.toHaveBeenCalled();
        expect(prisma.legalGuardian.create).not.toHaveBeenCalled();
      });

      it('nunca loguea RUT ni email al rechazar un menor', async () => {
        prisma.patient.findFirst.mockResolvedValue(
          buildPatient({ id: 'minor-1', rut: '11111111-1' }),
        );
        prisma.legalGuardian.findFirst.mockResolvedValue(null);
        const warnSpy = jest.spyOn(
          (service as unknown as { logger: { warn: (msg: string) => void } })
            .logger,
          'warn',
        );

        await expect(
          service.resolveForPublicBooking(
            'therapist-1',
            minorDto as never,
            undefined,
            undefined,
            guardian as never,
          ),
        ).rejects.toThrow(ConflictException);

        for (const call of warnSpy.mock.calls) {
          const message = String(call[0]);
          expect(message).not.toContain('11111111');
          expect(message).not.toContain('12345678');
          expect(message.toLowerCase()).not.toContain('madre@ejemplo.cl');
        }
      });
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
