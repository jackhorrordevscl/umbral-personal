import { buildTestClinicalCrypto } from '../../common/crypto/clinical-text-crypto.testing';
import { encryptDischargeTexts } from './util/discharge-text.util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TreatmentDischarge } from '@prisma/client';
import { DischargesService } from './discharges.service';
import { DischargeCancellationNotifier } from './discharge-cancellation-notifier.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientsService } from '../patients/patients.service';
import { AuditService } from '../audit/audit.service';
import { AvailabilityService } from '../availability/availability.service';
import { PaymentsService } from '../payments/payments.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import { DocumentsService } from '../documents/documents.service';
import {
  computeDischargeHash,
  dischargeHashInputFromRow,
} from './util/discharge-hash.util';

// Primer argumento de la primera llamada de un mock, tipado.
function firstCallArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown[][])[0][0] as T;
}

function buildRow(overrides: Partial<TreatmentDischarge> = {}) {
  return {
    id: 'dis-1',
    patientId: 'patient-1',
    therapistId: 'therapist-1',
    groupId: 'dis-1',
    version: 1,
    correctsId: null,
    source: 'GENERATED',
    status: 'DRAFT',
    closureReason: 'DISCHARGED',
    dropoutReason: null,
    dropoutNote: null,
    referralDestination: null,
    admissionDate: new Date('2026-03-02T00:00:00.000Z'),
    dischargeDate: new Date('2026-03-30T00:00:00.000Z'),
    sessionCount: 10,
    consultReason: 'Ansiedad',
    diagnosis: null,
    evolutionSummary: 'Evolución favorable',
    statusAtDischarge: 'Estable',
    recommendations: 'Control en 3 meses',
    signerName: null,
    signerRut: null,
    signerProfessionalRegistration: null,
    issuedAt: null,
    contentHash: null,
    documentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TreatmentDischarge;
}

describe('DischargesService', () => {
  let service: DischargesService;
  let prisma: {
    patient: { findFirst: jest.Mock; update: jest.Mock };
    treatmentDischarge: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    consultation: {
      count: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    bookedSlot: { deleteMany: jest.Mock };
    user: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let patientsService: {
    assertAccess: jest.Mock;
    assertTreatmentConsent: jest.Mock;
  };
  let auditService: { log: jest.Mock };
  let availabilityService: { invalidate: jest.Mock };
  let paymentsService: { cancelUnpaid: jest.Mock };
  let cancellationNotifier: { notify: jest.Mock };
  let calendarSync: { deleteEventsForGroups: jest.Mock };

  beforeEach(() => {
    prisma = {
      patient: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'patient-1',
          treatmentStatus: 'ACTIVE',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      treatmentDischarge: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          issuedAt: new Date('2026-01-10T12:00:00.000Z'),
        }),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
      consultation: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      bookedSlot: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Ana Pérez',
          rut: '12345678-5',
          professionalRegistration: 'Reg. 4521',
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(prisma),
    );
    patientsService = {
      assertAccess: jest.fn().mockResolvedValue({ id: 'patient-1' }),
      assertTreatmentConsent: jest.fn().mockResolvedValue(undefined),
    };
    auditService = { log: jest.fn().mockResolvedValue({}) };
    availabilityService = { invalidate: jest.fn() };
    paymentsService = { cancelUnpaid: jest.fn().mockResolvedValue(undefined) };
    cancellationNotifier = { notify: jest.fn().mockResolvedValue(undefined) };
    calendarSync = {
      deleteEventsForGroups: jest.fn().mockResolvedValue(undefined),
    };
    service = new DischargesService(
      prisma as unknown as PrismaService,
      patientsService as unknown as PatientsService,
      auditService as unknown as AuditService,
      availabilityService as unknown as AvailabilityService,
      paymentsService as unknown as PaymentsService,
      calendarSync as unknown as CalendarSyncService,
      {} as unknown as DocumentsService,
      cancellationNotifier as unknown as DischargeCancellationNotifier,

      buildTestClinicalCrypto(),
    );
    // T3: la generación del PDF tras emitir se prueba en
    // discharges.service.pdf.spec.ts; aquí se neutraliza para que las pruebas
    // de issue() sigan contando solo sus propias llamadas a prisma.
    jest.spyOn(service, 'ensurePdf').mockResolvedValue(buildRow());
  });

  describe('createDraft', () => {
    it('propaga el 404 uniforme de assertAccess (paciente ajeno)', async () => {
      patientsService.assertAccess.mockRejectedValue(new NotFoundException());
      await expect(
        service.createDraft(
          'patient-x',
          { closureReason: 'DISCHARGED' },
          'therapist-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.treatmentDischarge.create).not.toHaveBeenCalled();
    });

    it('prellena solo recuento y fechas, y nunca copia notas clínicas', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(null);
      prisma.consultation.count.mockResolvedValue(7);
      prisma.consultation.findFirst.mockResolvedValue({
        sessionDate: new Date('2026-02-10T15:00:00.000Z'),
      });
      prisma.treatmentDischarge.create.mockImplementation(
        ({ data }: { data: unknown }) => Promise.resolve(data),
      );

      const created = (await service.createDraft(
        'patient-1',
        { closureReason: 'DISCHARGED' },
        'therapist-1',
      )) as unknown as Record<string, unknown>;

      expect(created.sessionCount).toBe(7);
      expect(created.groupId).toBe(created.id);
      expect(created.version).toBe(1);
      expect((created.admissionDate as Date).toISOString()).toBe(
        '2026-02-10T00:00:00.000Z',
      );
      expect(created).not.toHaveProperty('consultReason');
      expect(created).not.toHaveProperty('evolutionSummary');
      const where = firstCallArg<{ where: unknown }>(
        prisma.consultation.count,
      ).where;
      expect(where).toEqual(
        expect.objectContaining({
          patientId: 'patient-1',
          therapistId: 'therapist-1',
          correctedBy: null,
          deletedAt: null,
          cancelledAt: null,
        }),
      );
    });

    it('rechaza DROPPED_OUT sin dropoutReason con 400', async () => {
      await expect(
        service.createDraft(
          'patient-1',
          { closureReason: 'DROPPED_OUT' },
          'therapist-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza dropoutReason con un cierre que no es deserción', async () => {
      await expect(
        service.createDraft(
          'patient-1',
          { closureReason: 'DISCHARGED', dropoutReason: 'COST' },
          'therapist-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('responde 409 si el tratamiento del paciente ya está cerrado', async () => {
      prisma.patient.findFirst.mockResolvedValue({
        treatmentStatus: 'DISCHARGED',
      });
      await expect(
        service.createDraft(
          'patient-1',
          { closureReason: 'DISCHARGED' },
          'therapist-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('es atómico: comprueba y crea dentro de una transacción con los locks User y luego Patient', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(null);
      prisma.treatmentDischarge.create.mockImplementation(
        ({ data }: { data: unknown }) => Promise.resolve(data),
      );

      await service.createDraft(
        'patient-1',
        { closureReason: 'DISCHARGED' },
        'therapist-1',
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const sqls = (prisma.$queryRaw.mock.calls as unknown[][]).map((c) =>
        (c[0] as string[]).join('?'),
      );
      expect(sqls).toHaveLength(2);
      expect(sqls[0]).toContain('"User"');
      expect(sqls[0]).toContain('FOR UPDATE');
      expect(sqls[1]).toContain('"Patient"');
      expect(sqls[1]).toContain('FOR UPDATE');
      const [, patientLock] = prisma.$queryRaw.mock.invocationCallOrder;
      expect(patientLock).toBeLessThan(
        prisma.treatmentDischarge.findFirst.mock.invocationCallOrder[0],
      );
      expect(patientLock).toBeLessThan(
        prisma.treatmentDischarge.create.mock.invocationCallOrder[0],
      );
    });

    it('responde 409 si ya hay un borrador abierto', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue({ id: 'otro' });
      await expect(
        service.createDraft(
          'patient-1',
          { closureReason: 'DISCHARGED' },
          'therapist-1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('filtra por terapeuta: un informe ajeno es 404', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(null);
      await expect(
        service.update('dis-1', { sessionCount: 3 }, 'intruder'),
      ).rejects.toThrow(NotFoundException);
      expect(
        firstCallArg<{ where: unknown }>(prisma.treatmentDischarge.findFirst)
          .where,
      ).toEqual(
        expect.objectContaining({ id: 'dis-1', therapistId: 'intruder' }),
      );
    });

    it('responde 409 si el informe ya fue emitido', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        buildRow({ status: 'ISSUED' }),
      );
      await expect(
        service.update('dis-1', { sessionCount: 3 }, 'therapist-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.treatmentDischarge.updateMany).not.toHaveBeenCalled();
    });

    it('valida las reglas cruzadas sobre el estado fusionado', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(buildRow());
      await expect(
        service.update(
          'dis-1',
          { closureReason: 'DROPPED_OUT' },
          'therapist-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.treatmentDischarge.updateMany).not.toHaveBeenCalled();
    });

    it('rechaza una fecha de ingreso posterior al alta', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(buildRow());
      await expect(
        service.update('dis-1', { admissionDate: '2026-04-01' }, 'therapist-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('actualiza de forma condicional a DRAFT y solo los campos enviados', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(buildRow());
      await service.update(
        'dis-1',
        { sessionCount: 11, diagnosis: null },
        'therapist-1',
      );
      expect(prisma.treatmentDischarge.updateMany).toHaveBeenCalledWith({
        where: { id: 'dis-1', therapistId: 'therapist-1', status: 'DRAFT' },
        data: { sessionCount: 11, diagnosis: null },
      });
    });

    it('responde 409 si una emisión concurrente ganó (count 0)', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(buildRow());
      prisma.treatmentDischarge.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.update('dis-1', { sessionCount: 3 }, 'therapist-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('issue', () => {
    beforeEach(() => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(buildRow());
      prisma.treatmentDischarge.findUniqueOrThrow.mockImplementation(() =>
        Promise.resolve(
          buildRow({
            status: 'ISSUED',
            issuedAt: new Date('2026-03-30T15:00:00.000Z'),
            contentHash: 'h',
          }),
        ),
      );
    });

    it('toma el lock del paciente, exige consentimiento y cierra el tratamiento en la misma transacción', async () => {
      const issued = await service.issue('dis-1', 'therapist-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
      expect(
        String(firstCallArg<string[]>(prisma.$queryRaw).join(' ')),
      ).toContain('FOR UPDATE');
      expect(patientsService.assertTreatmentConsent).toHaveBeenCalledWith(
        'patient-1',
        expect.stringContaining('consentimiento'),
        prisma,
      );
      expect(prisma.patient.update).toHaveBeenCalledWith({
        where: { id: 'patient-1' },
        data: { treatmentStatus: 'DISCHARGED' },
      });
      expect(issued.status).toBe('ISSUED');
    });

    it('toma los locks en el orden User, Patient e informe, antes de leer el estado del paciente y del informe', async () => {
      await service.issue('dis-1', 'therapist-1');

      const sqls = (prisma.$queryRaw.mock.calls as unknown[][]).map((c) =>
        (c[0] as string[]).join('?'),
      );
      expect(sqls).toHaveLength(3);
      expect(sqls[0]).toContain('"User"');
      expect(sqls[0]).toContain('FOR UPDATE');
      expect(sqls[1]).toContain('"Patient"');
      expect(sqls[1]).toContain('FOR UPDATE');
      expect(sqls[2]).toContain('"TreatmentDischarge"');
      expect(sqls[2]).toContain('FOR UPDATE');
      const [userLock, patientLock, dischargeLock] =
        prisma.$queryRaw.mock.invocationCallOrder;
      expect(userLock).toBeLessThan(patientLock);
      expect(patientLock).toBeLessThan(dischargeLock);
      expect(patientLock).toBeLessThan(
        prisma.patient.findFirst.mock.invocationCallOrder[0],
      );
      // La primera lectura del informe es findOwned, fuera de la transacción;
      // la relectura bajo lock es la última.
      expect(dischargeLock).toBeLessThan(
        prisma.treatmentDischarge.findFirst.mock.invocationCallOrder.at(-1)!,
      );
    });

    it('T3: genera el PDF tras el commit y devuelve documentId y pdfSha256', async () => {
      const ensure = jest.spyOn(service, 'ensurePdf').mockResolvedValue(
        buildRow({
          status: 'ISSUED',
          documentId: 'doc-pdf',
          pdfSha256: 'f'.repeat(64),
        }),
      );
      const issued = await service.issue('dis-1', 'therapist-1');

      expect(ensure).toHaveBeenCalledWith('dis-1', 'therapist-1');
      // Después del commit: la transacción ya terminó.
      expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
        ensure.mock.invocationCallOrder[0],
      );
      expect(issued.documentId).toBe('doc-pdf');
      expect(issued.pdfSha256).toBe('f'.repeat(64));
    });

    it('T3: si falla la generación del PDF, la emisión igual se completa y el fallo se registra', async () => {
      jest.spyOn(service, 'ensurePdf').mockRejectedValue(new Error('B2 caído'));
      const errorLog = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const issued = await service.issue('dis-1', 'therapist-1');

      expect(issued.status).toBe('ISSUED');
      expect(issued.documentId).toBeNull();
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining('Fallo al generar el PDF del informe'),
      );
      // El cierre y la auditoría de la emisión ocurrieron igual.
      expect(prisma.patient.update).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DISCHARGE_ISSUE' }),
      );
      errorLog.mockRestore();
    });

    it('rechaza con 409 emitir un informe nuevo (no corrección) si el paciente ya no está ACTIVE', async () => {
      prisma.patient.findFirst.mockResolvedValue({
        id: 'patient-1',
        treatmentStatus: 'DISCHARGED',
      });
      await expect(service.issue('dis-1', 'therapist-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.treatmentDischarge.updateMany).not.toHaveBeenCalled();
      expect(prisma.patient.update).not.toHaveBeenCalled();
      expect(prisma.consultation.findMany).not.toHaveBeenCalled();
    });

    describe('corrección (correctsId presente)', () => {
      function mockCorrection(closureReason = 'DISCHARGED') {
        const row = buildRow({
          id: 'dis-2',
          version: 2,
          correctsId: 'dis-1',
          closureReason: closureReason as TreatmentDischarge['closureReason'],
          referralDestination: closureReason === 'REFERRED' ? 'Hospital' : null,
        });
        prisma.treatmentDischarge.findFirst.mockResolvedValue(row);
        prisma.treatmentDischarge.findUniqueOrThrow.mockResolvedValue({
          ...row,
          status: 'ISSUED',
          issuedAt: new Date('2026-03-30T15:00:00.000Z'),
          contentHash: 'h',
        });
      }

      it('con el paciente reabierto (ACTIVE) emite sin tocar su estado ni sus consultas', async () => {
        mockCorrection();
        prisma.patient.findFirst.mockResolvedValue({
          id: 'patient-1',
          treatmentStatus: 'ACTIVE',
        });
        prisma.consultation.findMany.mockResolvedValue([
          { id: 'c-1', groupId: 'g-1' },
        ]);

        const issued = await service.issue('dis-2', 'therapist-1');

        expect(issued.status).toBe('ISSUED');
        expect(issued.cancelledConsultations).toBe(0);
        expect(prisma.patient.update).not.toHaveBeenCalled();
        expect(prisma.consultation.findMany).not.toHaveBeenCalled();
        expect(prisma.consultation.updateMany).not.toHaveBeenCalled();
        expect(prisma.bookedSlot.deleteMany).not.toHaveBeenCalled();
      });

      it('con el paciente aún cerrado y el mismo motivo no reescribe el estado, pero sí cancela futuras', async () => {
        mockCorrection('DISCHARGED');
        prisma.patient.findFirst.mockResolvedValue({
          id: 'patient-1',
          treatmentStatus: 'DISCHARGED',
        });
        prisma.consultation.findMany.mockResolvedValue([
          { id: 'c-1', groupId: 'g-1' },
        ]);
        prisma.consultation.updateMany.mockResolvedValue({ count: 1 });

        const issued = await service.issue('dis-2', 'therapist-1');

        expect(prisma.patient.update).not.toHaveBeenCalled();
        expect(prisma.consultation.updateMany).toHaveBeenCalledTimes(1);
        expect(issued.cancelledConsultations).toBe(1);
      });

      it('con el paciente cerrado y otro motivo actualiza treatmentStatus', async () => {
        mockCorrection('REFERRED');
        prisma.patient.findFirst.mockResolvedValue({
          id: 'patient-1',
          treatmentStatus: 'DISCHARGED',
        });

        await service.issue('dis-2', 'therapist-1');

        expect(prisma.patient.update).toHaveBeenCalledWith({
          where: { id: 'patient-1' },
          data: { treatmentStatus: 'REFERRED' },
        });
      });

      describe('corrección de un episodio anterior (hay un cierre posterior de otro grupo)', () => {
        beforeEach(() => {
          mockCorrection('DISCHARGED');
          prisma.patient.findFirst.mockResolvedValue({
            id: 'patient-1',
            treatmentStatus: 'REFERRED',
          });
          prisma.treatmentDischarge.count.mockResolvedValue(1);
          prisma.consultation.findMany.mockResolvedValue([
            { id: 'c-1', groupId: 'g-1' },
          ]);
        });

        it('no pisa el estado vigente ni cancela consultas', async () => {
          const issued = await service.issue('dis-2', 'therapist-1');

          expect(issued.status).toBe('ISSUED');
          expect(issued.cancelledConsultations).toBe(0);
          expect(prisma.patient.update).not.toHaveBeenCalled();
          expect(prisma.consultation.findMany).not.toHaveBeenCalled();
          expect(prisma.consultation.updateMany).not.toHaveBeenCalled();
          expect(prisma.bookedSlot.deleteMany).not.toHaveBeenCalled();
        });

        it('no audita TREATMENT_CLOSED, pero sí DISCHARGE_ISSUE', async () => {
          await service.issue('dis-2', 'therapist-1');

          const actions = (
            auditService.log.mock.calls as { action: string }[][]
          ).map((c) => c[0].action);
          expect(actions).toContain('DISCHARGE_ISSUE');
          expect(actions).not.toContain('TREATMENT_CLOSED');
        });

        it('busca un cierre emitido de otro grupo posterior a la raíz del grupo corregido', async () => {
          await service.issue('dis-2', 'therapist-1');

          expect(prisma.treatmentDischarge.findUnique).toHaveBeenCalledWith({
            where: { id: 'dis-1' },
            select: { issuedAt: true },
          });
          expect(prisma.treatmentDischarge.count).toHaveBeenCalledWith({
            where: {
              patientId: 'patient-1',
              status: 'ISSUED',
              groupId: { not: 'dis-1' },
              issuedAt: { gt: new Date('2026-01-10T12:00:00.000Z') },
            },
          });
        });
      });

      it('sin cierre posterior de otro grupo conserva el comportamiento actual', async () => {
        mockCorrection('REFERRED');
        prisma.patient.findFirst.mockResolvedValue({
          id: 'patient-1',
          treatmentStatus: 'DISCHARGED',
        });
        prisma.treatmentDischarge.count.mockResolvedValue(0);

        await service.issue('dis-2', 'therapist-1');

        expect(prisma.patient.update).toHaveBeenCalledWith({
          where: { id: 'patient-1' },
          data: { treatmentStatus: 'REFERRED' },
        });
        const actions = (
          auditService.log.mock.calls as { action: string }[][]
        ).map((c) => c[0].action);
        expect(actions).toContain('TREATMENT_CLOSED');
      });
    });

    it('un informe nuevo (no corrección) no consulta cierres de otros grupos', async () => {
      await service.issue('dis-1', 'therapist-1');

      expect(prisma.treatmentDischarge.count).not.toHaveBeenCalled();
    });

    it('guarda un hash que verify puede recalcular desde los mismos datos', async () => {
      await service.issue('dis-1', 'therapist-1');
      const data = firstCallArg<{
        data: Record<string, unknown>;
      }>(prisma.treatmentDischarge.updateMany).data;
      expect(data.status).toBe('ISSUED');
      expect(data.signerName).toBe('Ana Pérez');
      expect(data.signerRut).toBe('12345678-5');
      expect(data.signerProfessionalRegistration).toBe('Reg. 4521');

      const recomputed = computeDischargeHash(
        dischargeHashInputFromRow(
          buildRow({
            issuedAt: data.issuedAt as Date,
            signerName: 'Ana Pérez',
            signerRut: '12345678-5',
            signerProfessionalRegistration: 'Reg. 4521',
          }),
        ),
      );
      expect(data.contentHash).toBe(recomputed);
    });

    it('el hash cambia si cambia el RUT del snapshot', async () => {
      await service.issue('dis-1', 'therapist-1');
      const data = firstCallArg<{ data: Record<string, unknown> }>(
        prisma.treatmentDischarge.updateMany,
      ).data;
      const other = computeDischargeHash(
        dischargeHashInputFromRow(
          buildRow({
            issuedAt: data.issuedAt as Date,
            signerName: 'Ana Pérez',
            signerRut: '11111111-1',
            signerProfessionalRegistration: 'Reg. 4521',
          }),
        ),
      );
      expect(data.contentHash).not.toBe(other);
    });

    it('sin RUT cargado responde 400 accionable y no emite nada', async () => {
      prisma.user.findUnique.mockResolvedValue({
        name: 'Ana Pérez',
        rut: null,
        professionalRegistration: 'Reg. 4521',
      });
      const call = service.issue('dis-1', 'therapist-1');
      await expect(call).rejects.toThrow(BadRequestException);
      await expect(call).rejects.toThrow(
        'Completa tu RUT en tu perfil antes de emitir un informe de alta.',
      );
      expect(prisma.treatmentDischarge.updateMany).not.toHaveBeenCalled();
      expect(prisma.patient.update).not.toHaveBeenCalled();
    });

    it('el registro profesional es opcional: sin él emite con null', async () => {
      prisma.user.findUnique.mockResolvedValue({
        name: 'Ana Pérez',
        rut: '12345678-5',
        professionalRegistration: null,
      });
      await service.issue('dis-1', 'therapist-1');
      const data = firstCallArg<{ data: Record<string, unknown> }>(
        prisma.treatmentDischarge.updateMany,
      ).data;
      expect(data.signerRut).toBe('12345678-5');
      expect(data.signerProfessionalRegistration).toBeNull();
    });

    it('propaga el 403 sin consentimiento y no emite nada', async () => {
      patientsService.assertTreatmentConsent.mockRejectedValue(
        new ForbiddenException('sin consentimiento'),
      );
      await expect(service.issue('dis-1', 'therapist-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.treatmentDischarge.updateMany).not.toHaveBeenCalled();
      expect(prisma.patient.update).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('rechaza con 400 un informe generado con contenido incompleto', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        buildRow({ recommendations: '   ' }),
      );
      await expect(service.issue('dis-1', 'therapist-1')).rejects.toThrow(
        /recomendaciones/,
      );
    });

    it('responde 409 si el informe ya estaba emitido al releerlo bajo el lock', async () => {
      prisma.treatmentDischarge.findFirst
        .mockResolvedValueOnce(buildRow())
        .mockResolvedValueOnce(buildRow({ status: 'ISSUED' }));
      await expect(service.issue('dis-1', 'therapist-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('responde 409 si la transición condicional no afectó filas', async () => {
      prisma.treatmentDischarge.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.issue('dis-1', 'therapist-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.patient.update).not.toHaveBeenCalled();
    });

    it('audita DISCHARGE_ISSUE y TREATMENT_CLOSED con el motivo de deserción pero sin texto libre', async () => {
      const row = buildRow({
        closureReason: 'DROPPED_OUT',
        dropoutReason: 'OTHER',
        dropoutNote: 'detalle privado del terapeuta',
      });
      prisma.treatmentDischarge.findFirst.mockResolvedValue(row);
      prisma.treatmentDischarge.findUniqueOrThrow.mockResolvedValue({
        ...row,
        status: 'ISSUED',
        issuedAt: new Date(),
        contentHash: 'h',
      });

      await service.issue('dis-1', 'therapist-1', {
        ipAddress: '1.2.3.4',
        userAgent: 'jest',
      });

      const calls = (auditService.log.mock.calls as unknown[][]).map(
        (c) => c[0] as Record<string, string>,
      );
      expect(calls.map((c) => c.action)).toEqual([
        'DISCHARGE_ISSUE',
        'TREATMENT_CLOSED',
      ]);
      const closed = calls[1];
      expect(closed.detail).toContain('status=DROPPED_OUT');
      expect(closed.detail).toContain('dropoutReason=OTHER');
      expect(JSON.stringify(calls)).not.toContain('detalle privado');
      expect(closed.ipAddress).toBe('1.2.3.4');
    });

    describe('cancelación de consultas futuras (T2b)', () => {
      const futureRows = [
        { id: 'c-1', groupId: 'g-1' },
        { id: 'c-2', groupId: 'g-2' },
      ];

      function mockFutures(rows = futureRows) {
        prisma.consultation.findMany.mockResolvedValue(rows);
        prisma.consultation.updateMany.mockResolvedValue({
          count: rows.length,
        });
      }

      const anyDate: Date = expect.any(Date) as Date;

      // Deja correr los efectos posteriores al commit (promesas aisladas).
      const flush = () => new Promise((r) => setImmediate(r));

      it('cancela solo las futuras vigentes del paciente y terapeuta, y libera los BookedSlot en la misma transacción', async () => {
        mockFutures();

        const issued = await service.issue('dis-1', 'therapist-1');

        const find = firstCallArg<{ where: Record<string, unknown> }>(
          prisma.consultation.findMany,
        );
        expect(find.where).toEqual({
          patientId: 'patient-1',
          therapistId: 'therapist-1',
          correctedBy: null,
          deletedAt: null,
          sessionDate: { gt: anyDate },
        });
        const update = firstCallArg<{
          where: { id: { in: string[] } };
          data: Record<string, unknown>;
        }>(prisma.consultation.updateMany);
        expect(update.where).toEqual(
          expect.objectContaining({ id: { in: ['c-1', 'c-2'] } }),
        );
        expect(update.data).toEqual({
          cancelledAt: anyDate,
          cancelledByDischargeId: 'dis-1',
          deletedAt: anyDate,
        });
        // cancelledAt y deletedAt comparten el mismo instante.
        expect(update.data.cancelledAt).toBe(update.data.deletedAt);
        expect(prisma.bookedSlot.deleteMany).toHaveBeenCalledWith({
          where: { groupId: { in: ['g-1', 'g-2'] } },
        });
        expect(issued.cancelledConsultations).toBe(2);
        // Todo ocurre dentro de la única transacción.
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      });

      it('no usa Patient.deletedAt: el paciente solo cambia de treatmentStatus', async () => {
        mockFutures();
        await service.issue('dis-1', 'therapist-1');
        expect(prisma.patient.update).toHaveBeenCalledTimes(1);
        expect(
          firstCallArg<{ data: Record<string, unknown> }>(prisma.patient.update)
            .data,
        ).toEqual({ treatmentStatus: 'DISCHARGED' });
      });

      it('sin consultas futuras omite el paso sin error', async () => {
        const issued = await service.issue('dis-1', 'therapist-1');
        await flush();

        expect(prisma.consultation.updateMany).not.toHaveBeenCalled();
        expect(prisma.bookedSlot.deleteMany).not.toHaveBeenCalled();
        expect(paymentsService.cancelUnpaid).not.toHaveBeenCalled();
        expect(calendarSync.deleteEventsForGroups).not.toHaveBeenCalled();
        expect(issued.cancelledConsultations).toBe(0);
        const actions = (auditService.log.mock.calls as unknown[][]).map(
          (c) => (c[0] as { action: string }).action,
        );
        expect(actions).not.toContain('CONSULTATION_CANCELLED');
      });

      it('colapsa versiones del mismo grupo en un solo groupId', async () => {
        mockFutures([
          { id: 'c-1', groupId: 'g-1' },
          { id: 'c-1b', groupId: 'g-1' },
        ]);
        await service.issue('dis-1', 'therapist-1');
        await flush();
        expect(prisma.bookedSlot.deleteMany).toHaveBeenCalledWith({
          where: { groupId: { in: ['g-1'] } },
        });
        expect(paymentsService.cancelUnpaid).toHaveBeenCalledTimes(1);
      });

      it('avisa de las consultas canceladas con el id del informe emitido (T4b)', async () => {
        mockFutures();
        await service.issue('dis-1', 'therapist-1');
        await flush();

        expect(cancellationNotifier.notify).toHaveBeenCalledTimes(1);
        expect(cancellationNotifier.notify).toHaveBeenCalledWith('dis-1');
      });

      it('no avisa si el cierre no canceló ninguna consulta (T4b)', async () => {
        mockFutures([]);
        await service.issue('dis-1', 'therapist-1');
        await flush();

        expect(cancellationNotifier.notify).not.toHaveBeenCalled();
      });

      it('un aviso que lanza no revierte el cierre (T4b)', async () => {
        mockFutures();
        cancellationNotifier.notify.mockRejectedValue(new Error('mail down'));

        await expect(
          service.issue('dis-1', 'therapist-1'),
        ).resolves.toBeDefined();
      });

      it('dispara los efectos posteriores al commit con los groupId cancelados', async () => {
        mockFutures();
        await service.issue('dis-1', 'therapist-1');
        await flush();

        expect(availabilityService.invalidate).toHaveBeenCalledWith(
          'therapist-1',
        );
        expect(paymentsService.cancelUnpaid).toHaveBeenCalledWith('g-1');
        expect(paymentsService.cancelUnpaid).toHaveBeenCalledWith('g-2');
        expect(calendarSync.deleteEventsForGroups).toHaveBeenCalledWith(
          'therapist-1',
          ['g-1', 'g-2'],
        );
      });

      it('los efectos posteriores no corren si la transacción falla', async () => {
        mockFutures();
        prisma.treatmentDischarge.updateMany.mockResolvedValue({ count: 0 });
        await expect(service.issue('dis-1', 'therapist-1')).rejects.toThrow(
          ConflictException,
        );
        await flush();
        expect(availabilityService.invalidate).not.toHaveBeenCalled();
        expect(paymentsService.cancelUnpaid).not.toHaveBeenCalled();
        expect(calendarSync.deleteEventsForGroups).not.toHaveBeenCalled();
      });

      describe('aislamiento de fallos posteriores al commit', () => {
        let loggerSpy: jest.SpyInstance;
        beforeEach(() => {
          mockFutures();
          loggerSpy = jest
            .spyOn(Logger.prototype, 'error')
            .mockImplementation(() => undefined);
        });
        afterEach(() => loggerSpy.mockRestore());

        it('un rechazo de la pasarela de pago no impide el cierre ni los demás efectos', async () => {
          paymentsService.cancelUnpaid.mockRejectedValueOnce(
            new Error('flow caído'),
          );
          const issued = await service.issue('dis-1', 'therapist-1');
          await flush();

          expect(issued.status).toBe('ISSUED');
          expect(paymentsService.cancelUnpaid).toHaveBeenCalledTimes(2);
          expect(calendarSync.deleteEventsForGroups).toHaveBeenCalled();
          expect(availabilityService.invalidate).toHaveBeenCalled();
          expect(loggerSpy).toHaveBeenCalledWith(
            expect.stringContaining('flow caído'),
          );
        });

        it('un rechazo de Google no impide el cierre ni los demás efectos', async () => {
          calendarSync.deleteEventsForGroups.mockRejectedValue(
            new Error('google caído'),
          );
          const issued = await service.issue('dis-1', 'therapist-1');
          await flush();

          expect(issued.status).toBe('ISSUED');
          expect(paymentsService.cancelUnpaid).toHaveBeenCalledTimes(2);
          expect(loggerSpy).toHaveBeenCalledWith(
            expect.stringContaining('google caído'),
          );
        });

        it('un fallo síncrono de la invalidación de caché no impide los demás efectos', async () => {
          availabilityService.invalidate.mockImplementation(() => {
            throw new Error('cache rota');
          });
          const issued = await service.issue('dis-1', 'therapist-1');
          await flush();

          expect(issued.status).toBe('ISSUED');
          expect(paymentsService.cancelUnpaid).toHaveBeenCalledTimes(2);
          expect(calendarSync.deleteEventsForGroups).toHaveBeenCalled();
          expect(loggerSpy).toHaveBeenCalledWith(
            expect.stringContaining('cache rota'),
          );
        });
      });

      it('audita una fila CONSULTATION_CANCELLED por groupId sin motivo ni texto libre, y cuenta en TREATMENT_CLOSED', async () => {
        const row = buildRow({
          closureReason: 'DROPPED_OUT',
          dropoutReason: 'OTHER',
          dropoutNote: 'detalle privado del terapeuta',
        });
        prisma.treatmentDischarge.findFirst.mockResolvedValue(row);
        prisma.treatmentDischarge.findUniqueOrThrow.mockResolvedValue({
          ...row,
          status: 'ISSUED',
          issuedAt: new Date(),
          contentHash: 'h',
        });
        mockFutures();

        await service.issue('dis-1', 'therapist-1', { ipAddress: '1.2.3.4' });

        const calls = (auditService.log.mock.calls as unknown[][]).map(
          (c) => c[0] as Record<string, string>,
        );
        const cancelled = calls.filter(
          (c) => c.action === 'CONSULTATION_CANCELLED',
        );
        expect(cancelled.map((c) => c.resourceId)).toEqual(['g-1', 'g-2']);
        for (const c of cancelled) {
          expect(c.resource).toBe('Consultation');
          expect(c.userId).toBe('therapist-1');
          expect(c.detail).toContain('status=DROPPED_OUT');
          expect(c.detail).toContain('dischargeId=dis-1');
          expect(c.ipAddress).toBe('1.2.3.4');
        }
        expect(JSON.stringify(calls)).not.toContain('detalle privado');
        expect(JSON.stringify(cancelled)).not.toContain('dropoutReason');
        const closed = calls.find((c) => c.action === 'TREATMENT_CLOSED');
        expect(closed?.detail).toContain('cancelledConsultations=2');
      });
    });

    it('un fallo de auditoría no revierte ni rompe la emisión (fail-open)', async () => {
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      auditService.log.mockRejectedValue(new Error('db caída'));
      await expect(service.issue('dis-1', 'therapist-1')).resolves.toEqual(
        expect.objectContaining({ status: 'ISSUED' }),
      );
      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
    });
  });

  describe('correct', () => {
    it('crea una versión DRAFT heredando groupId y enlazando correctsId', async () => {
      const original = buildRow({
        status: 'ISSUED',
        version: 2,
        groupId: 'grp',
        id: 'dis-2',
      });
      prisma.treatmentDischarge.findFirst
        .mockResolvedValueOnce(original)
        .mockResolvedValueOnce(null);
      prisma.treatmentDischarge.create.mockImplementation(
        ({ data }: { data: unknown }) => Promise.resolve(data),
      );

      const created = (await service.correct(
        'dis-2',
        'therapist-1',
      )) as unknown as Record<string, unknown>;

      expect(created.groupId).toBe('grp');
      expect(created.correctsId).toBe('dis-2');
      expect(created.version).toBe(3);
      expect(created.status).toBe('DRAFT');
      expect(created).not.toHaveProperty('contentHash');
      expect(created).not.toHaveProperty('issuedAt');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DISCHARGE_CORRECT' }),
      );
    });

    it('toma los locks User y luego Patient antes de comprobar la corrección y crear', async () => {
      prisma.treatmentDischarge.findFirst
        .mockResolvedValueOnce(buildRow({ status: 'ISSUED', id: 'dis-2' }))
        .mockResolvedValueOnce(null);
      prisma.treatmentDischarge.create.mockImplementation(
        ({ data }: { data: unknown }) => Promise.resolve(data),
      );

      await service.correct('dis-2', 'therapist-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const sqls = (prisma.$queryRaw.mock.calls as unknown[][]).map((c) =>
        (c[0] as string[]).join('?'),
      );
      expect(sqls).toHaveLength(2);
      expect(sqls[0]).toContain('"User"');
      expect(sqls[0]).toContain('FOR UPDATE');
      expect(sqls[1]).toContain('"Patient"');
      expect(sqls[1]).toContain('FOR UPDATE');
      const [, patientLock] = prisma.$queryRaw.mock.invocationCallOrder;
      const [, alreadyCorrectedCheck] =
        prisma.treatmentDischarge.findFirst.mock.invocationCallOrder;
      expect(patientLock).toBeLessThan(alreadyCorrectedCheck);
      expect(patientLock).toBeLessThan(
        prisma.treatmentDischarge.create.mock.invocationCallOrder[0],
      );
    });

    it('rechaza corregir un borrador (409)', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(buildRow());
      await expect(service.correct('dis-1', 'therapist-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rechaza corregir una versión que ya tiene corrección (409)', async () => {
      prisma.treatmentDischarge.findFirst
        .mockResolvedValueOnce(buildRow({ status: 'ISSUED' }))
        .mockResolvedValueOnce({ id: 'sig' });
      await expect(service.correct('dis-1', 'therapist-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.treatmentDischarge.create).not.toHaveBeenCalled();
    });

    it('traduce el P2002 de correctsId @unique a 409', async () => {
      prisma.treatmentDischarge.findFirst
        .mockResolvedValueOnce(buildRow({ status: 'ISSUED' }))
        .mockResolvedValueOnce(null);
      prisma.treatmentDischarge.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(service.correct('dis-1', 'therapist-1')).rejects.toThrow(
        ConflictException,
      );
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('un informe ajeno es 404', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(null);
      await expect(service.correct('dis-1', 'intruder')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('verify', () => {
    function issuedRow(overrides: Partial<TreatmentDischarge> = {}) {
      const base = buildRow({
        status: 'ISSUED',
        issuedAt: new Date('2026-03-30T15:00:00.000Z'),
        signerName: 'Ana Pérez',
        ...overrides,
      });
      return {
        ...base,
        contentHash:
          overrides.contentHash ??
          computeDischargeHash(
            dischargeHashInputFromRow(buildRow({ ...base, ...overrides })),
          ),
        correctedBy: null,
      };
    }

    it('devuelve valid=true cuando el contenido coincide y no expone contenido clínico', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(issuedRow());
      const result = await service.verify('dis-1', 'therapist-1');
      expect(result.valid).toBe(true);
      expect(result.isCurrent).toBe(true);
      // Issue #492: en un informe generado el hash cubre todo el contenido.
      expect(result.hashScope).toBe('CONTENT');
      expect(result).not.toHaveProperty('evolutionSummary');
      expect(result).not.toHaveProperty('consultReason');
    });

    it('responde valid=false, sin lanzar, si un texto cifrado está alterado, y lo registra sin contenido', async () => {
      const good = encryptDischargeTexts(
        { consultReason: 'Motivo reservado' },
        buildTestClinicalCrypto(),
        'patient-1',
      ).consultReason;
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        issuedRow({ consultReason: `${good.slice(0, -4)}AAAA` }),
      );
      const errorLog = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const result = await service.verify('dis-1', 'therapist-1');

      expect(result.valid).toBe(false);
      expect(result.dischargeId).toBe('dis-1');
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining('dischargeId=dis-1'),
      );
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining('consultReason'),
      );
      expect(errorLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Motivo reservado'),
      );
      errorLog.mockRestore();
    });

    it('detecta una alteración directa en la base', async () => {
      const row = issuedRow();
      prisma.treatmentDischarge.findFirst.mockResolvedValue({
        ...row,
        sessionCount: row.sessionCount + 1,
      });
      expect((await service.verify('dis-1', 'therapist-1')).valid).toBe(false);
    });

    it('detecta que se reencadenó la versión alterando correctsId', async () => {
      const row = issuedRow({ version: 2, correctsId: 'dis-0' });
      prisma.treatmentDischarge.findFirst.mockResolvedValue({
        ...row,
        correctsId: null,
      });
      expect((await service.verify('dis-1', 'therapist-1')).valid).toBe(false);
    });

    it('marca isCurrent=false si existe una corrección posterior', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue({
        ...issuedRow(),
        correctedBy: { id: 'dis-2' },
      });
      expect((await service.verify('dis-1', 'therapist-1')).isCurrent).toBe(
        false,
      );
    });

    it('responde 409 para un borrador y 404 para un informe ajeno', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValueOnce({
        ...buildRow(),
        correctedBy: null,
      });
      await expect(service.verify('dis-1', 'therapist-1')).rejects.toThrow(
        ConflictException,
      );
      prisma.treatmentDischarge.findFirst.mockResolvedValueOnce(null);
      await expect(service.verify('dis-1', 'intruder')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancellationPreview', () => {
    it('exige acceso, consulta solo vigentes futuras y cuenta grupos distintos', async () => {
      const d1 = new Date('2030-01-01T10:00:00Z');
      const d2 = new Date('2030-01-02T10:00:00Z');
      prisma.consultation.findMany.mockResolvedValue([
        { id: 'c1', groupId: 'g1', sessionDate: d1 },
        { id: 'c1b', groupId: 'g1', sessionDate: d1 },
        { id: 'c2', groupId: 'g2', sessionDate: d2 },
      ]);

      const result = await service.cancellationPreview(
        'patient-1',
        'therapist-1',
      );

      expect(patientsService.assertAccess).toHaveBeenCalledWith(
        'patient-1',
        'therapist-1',
      );
      const where = firstCallArg<{
        where: {
          patientId: string;
          therapistId: string;
          correctedBy: null;
          deletedAt: null;
          sessionDate: { gt: Date };
        };
      }>(prisma.consultation.findMany).where;
      expect(where).toMatchObject({
        patientId: 'patient-1',
        therapistId: 'therapist-1',
        correctedBy: null,
        deletedAt: null,
      });
      expect(where.sessionDate.gt).toBeInstanceOf(Date);
      expect(result.count).toBe(2);
      expect(result.consultations).toHaveLength(3);
      expect(prisma.consultation.updateMany).not.toHaveBeenCalled();
    });

    it('sin consultas futuras devuelve count 0', async () => {
      const result = await service.cancellationPreview(
        'patient-1',
        'therapist-1',
      );
      expect(result).toEqual({ count: 0, consultations: [] });
    });
  });

  describe('findByPatient', () => {
    it('exige acceso al paciente y filtra por terapeuta', async () => {
      prisma.treatmentDischarge.findMany.mockResolvedValue([]);
      await service.findByPatient('patient-1', 'therapist-1');
      expect(patientsService.assertAccess).toHaveBeenCalledWith(
        'patient-1',
        'therapist-1',
      );
      expect(
        firstCallArg<{ where: unknown }>(prisma.treatmentDischarge.findMany)
          .where,
      ).toEqual({
        patientId: 'patient-1',
        therapistId: 'therapist-1',
      });
    });

    describe('con un texto cifrado ilegible', () => {
      const good = encryptDischargeTexts(
        { diagnosis: 'Diagnóstico reservado' },
        buildTestClinicalCrypto(),
        'patient-1',
      ).diagnosis;
      const tampered = `${good.slice(0, -4)}AAAA`;

      it('devuelve todas las filas, con el campo en null y unreadableFields solo en la afectada', async () => {
        prisma.treatmentDischarge.findMany.mockResolvedValue([
          buildRow({ id: 'dis-1', diagnosis: good }),
          buildRow({ id: 'dis-2', diagnosis: tampered }),
        ]);
        const errorLog = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);

        const rows = await service.findByPatient('patient-1', 'therapist-1');

        expect(rows).toHaveLength(2);
        expect(rows[0].diagnosis).toBe('Diagnóstico reservado');
        expect(rows[0]).not.toHaveProperty('unreadableFields');
        expect(rows[1].diagnosis).toBeNull();
        expect(rows[1]).toMatchObject({ unreadableFields: ['diagnosis'] });
        expect(errorLog).toHaveBeenCalledWith(
          expect.stringContaining('dischargeId=dis-2'),
        );
        errorLog.mockRestore();
      });

      it('findOne sigue siendo estricto: no entrega una fila a medias', async () => {
        prisma.treatmentDischarge.findFirst.mockResolvedValue(
          buildRow({ diagnosis: tampered }),
        );

        await expect(service.findOne('dis-1', 'therapist-1')).rejects.toThrow();
      });
    });
  });
});
