import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssentsService } from './assents.service';
import { PatientsService } from './patients.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UNPAGINATED_SAFETY_LIMIT } from '../../common/dto/pagination.dto';

describe('AssentsService', () => {
  let service: AssentsService;
  let prisma: {
    patientAssent: { findMany: jest.Mock; create: jest.Mock };
    patientDocument: { findFirst: jest.Mock };
  };
  let patientsService: { assertAccess: jest.Mock };

  // Pinned clock: 2015-01-01 is 11 years old (UNDER_14), 2010-01-01 is 16
  // (AGE_14_17), 1990-01-01 is an adult.
  const minor = (birthDate: string) => ({
    id: 'patient-1',
    rut: '11111111-1',
    birthDate: new Date(birthDate),
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-08T15:00:00Z'));
    prisma = {
      patientAssent: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'assent-1' }),
      },
      patientDocument: { findFirst: jest.fn() },
    };
    patientsService = {
      assertAccess: jest.fn().mockResolvedValue(minor('2015-01-01')),
    };
    service = new AssentsService(
      prisma as unknown as PrismaService,
      patientsService as unknown as PatientsService,
    );
  });
  afterEach(() => jest.useRealTimers());

  describe('list', () => {
    it('valida acceso y devuelve el ledger ordenado y acotado', async () => {
      await service.list('patient-1', 'therapist-1');

      expect(patientsService.assertAccess).toHaveBeenCalledWith(
        'patient-1',
        'therapist-1',
      );
      expect(prisma.patientAssent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { patientId: 'patient-1' },
          orderBy: { recordedAt: 'desc' },
          take: UNPAGINATED_SAFETY_LIMIT,
        }),
      );
    });

    it('propaga el 404 uniforme de assertAccess sin consultar el ledger', async () => {
      patientsService.assertAccess.mockRejectedValue(new NotFoundException());

      await expect(service.list('patient-1', 'otro')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.patientAssent.findMany).not.toHaveBeenCalled();
    });
  });

  describe('record', () => {
    it('menor de 14: calcula el tramo en el servidor y registra el evento', async () => {
      await service.record(
        'patient-1',
        { action: 'INFORMED_AND_HEARD', note: '  Escuchado en sesión  ' },
        'therapist-1',
      );

      expect(prisma.patientAssent.create).toHaveBeenCalledWith({
        data: {
          patientId: 'patient-1',
          ageBand: 'UNDER_14',
          action: 'INFORMED_AND_HEARD',
          note: 'Escuchado en sesión',
          documentId: null,
          recordedById: 'therapist-1',
        },
      });
    });

    it('14 a 17: el tramo es AGE_14_17', async () => {
      patientsService.assertAccess.mockResolvedValue(minor('2010-01-01'));

      await service.record('patient-1', { action: 'REFUSED' }, 'therapist-1');

      expect(prisma.patientAssent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ageBand: 'AGE_14_17',
          action: 'REFUSED',
          note: null,
        }) as unknown,
      });
    });

    it('un adulto: 400 y no escribe nada', async () => {
      patientsService.assertAccess.mockResolvedValue(minor('1990-01-01'));

      await expect(
        service.record('patient-1', { action: 'GRANTED' }, 'therapist-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.patientAssent.create).not.toHaveBeenCalled();
    });

    it('propaga el 404 uniforme de assertAccess', async () => {
      patientsService.assertAccess.mockRejectedValue(new NotFoundException());

      await expect(
        service.record('patient-1', { action: 'GRANTED' }, 'otro'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.patientAssent.create).not.toHaveBeenCalled();
    });

    it('documentId: exige un documento NO anulado del mismo paciente', async () => {
      prisma.patientDocument.findFirst.mockResolvedValue({ id: 'doc-1' });

      await service.record(
        'patient-1',
        { action: 'GRANTED', documentId: 'doc-1' },
        'therapist-1',
      );

      expect(prisma.patientDocument.findFirst).toHaveBeenCalledWith({
        where: { id: 'doc-1', patientId: 'patient-1', voidedAt: null },
        select: { id: true },
      });
      expect(prisma.patientAssent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ documentId: 'doc-1' }) as unknown,
      });
    });

    it('documentId anulado, ajeno o inexistente: 400 y no escribe nada', async () => {
      prisma.patientDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.record(
          'patient-1',
          { action: 'GRANTED', documentId: 'doc-x' },
          'therapist-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.patientAssent.create).not.toHaveBeenCalled();
    });

    it('es append-only: el servicio no expone actualizar ni borrar', () => {
      expect(service).not.toHaveProperty('update');
      expect(service).not.toHaveProperty('remove');
    });
  });
});
