import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GuardiansService } from './guardians.service';
import { PatientsService } from './patients.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MAX_GUARDIANS_PER_PATIENT } from './patients.constants';

function buildGuardian(overrides: Record<string, unknown> = {}) {
  return {
    id: 'guardian-1',
    patientId: 'patient-1',
    fullName: 'María Soto',
    rut: '12345678-5',
    relationship: 'MOTHER',
    email: null,
    phone: null,
    isPayer: false,
    receivesCommunications: true,
    canAccessReports: true,
    canConsent: true,
    custody: 'UNKNOWN',
    hasConflict: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('GuardiansService', () => {
  let service: GuardiansService;
  let prisma: {
    legalGuardian: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    patientConsent: { count: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let patientsService: { assertAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      legalGuardian: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve(buildGuardian(args.data)),
        ),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve(buildGuardian(args.data)),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn().mockResolvedValue(buildGuardian()),
      },
      patientConsent: { count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'patient-1' }]),
      $transaction: jest.fn((arg: unknown) =>
        (arg as (tx: unknown) => unknown)(prisma),
      ),
    };
    patientsService = {
      assertAccess: jest
        .fn()
        .mockResolvedValue({ id: 'patient-1', rut: '1-9' }),
    };

    service = new GuardiansService(
      prisma as unknown as PrismaService,
      patientsService as unknown as PatientsService,
    );
  });

  describe('acceso al paciente', () => {
    it.each([
      ['list', () => service.list('patient-1', 'therapist-2')],
      [
        'create',
        () =>
          service.create(
            'patient-1',
            {
              fullName: 'María Soto',
              rut: '12345678-5',
              relationship: 'MOTHER',
            },
            'therapist-2',
          ),
      ],
      [
        'update',
        () => service.update('patient-1', 'guardian-1', {}, 'therapist-2'),
      ],
      [
        'remove',
        () => service.remove('patient-1', 'guardian-1', 'therapist-2'),
      ],
    ])(
      '%s devuelve 404 si el paciente no es del terapeuta',
      async (_n, run) => {
        patientsService.assertAccess.mockRejectedValue(
          new NotFoundException('Paciente no encontrado'),
        );

        await expect(run()).rejects.toThrow(NotFoundException);
        expect(patientsService.assertAccess).toHaveBeenCalledWith(
          'patient-1',
          'therapist-2',
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.legalGuardian.findMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('list', () => {
    it('lista los representantes del paciente ordenados por createdAt', async () => {
      prisma.legalGuardian.findMany.mockResolvedValue([buildGuardian()]);

      const result = await service.list('patient-1', 'therapist-1');

      expect(result).toHaveLength(1);
      expect(prisma.legalGuardian.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('create', () => {
    const dto = {
      fullName: 'María Soto',
      rut: '12.345.678-5',
      relationship: 'MOTHER' as const,
    };

    it('bloquea la fila del paciente dentro de la transacción antes de contar', async () => {
      const order: string[] = [];
      prisma.$queryRaw.mockImplementation(() => {
        order.push('lock');
        return Promise.resolve([{ id: 'patient-1' }]);
      });
      prisma.legalGuardian.count.mockImplementation(() => {
        order.push('count');
        return Promise.resolve(0);
      });
      prisma.legalGuardian.create.mockImplementation(() => {
        order.push('create');
        return Promise.resolve(buildGuardian());
      });

      await service.create('patient-1', dto, 'therapist-1');

      expect(order).toEqual(['lock', 'count', 'create']);
    });

    it('crea el representante con el RUT normalizado y el patientId de la ruta', async () => {
      await service.create('patient-1', dto, 'therapist-1');

      expect(prisma.legalGuardian.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          patientId: 'patient-1',
          rut: '12345678-5',
          fullName: 'María Soto',
          relationship: 'MOTHER',
        }) as unknown,
      });
    });

    it('convierte email y teléfono vacíos en null', async () => {
      await service.create(
        'patient-1',
        { ...dto, email: '', phone: '' },
        'therapist-1',
      );

      expect(prisma.legalGuardian.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ email: null, phone: null }) as unknown,
      });
    });

    it('permite crear hasta el tope y rechaza con 409 el siguiente', async () => {
      prisma.legalGuardian.count.mockResolvedValue(MAX_GUARDIANS_PER_PATIENT);

      await expect(
        service.create('patient-1', dto, 'therapist-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.legalGuardian.create).not.toHaveBeenCalled();
    });

    it('permite crear el último cupo', async () => {
      prisma.legalGuardian.count.mockResolvedValue(
        MAX_GUARDIANS_PER_PATIENT - 1,
      );

      await service.create('patient-1', dto, 'therapist-1');

      expect(prisma.legalGuardian.create).toHaveBeenCalled();
    });

    it('devuelve 404 si el paciente fue dado de baja entre el chequeo y el bloqueo', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.create('patient-1', dto, 'therapist-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.legalGuardian.create).not.toHaveBeenCalled();
    });

    it('al marcar isPayer, desmarca a los demás pagadores en la misma transacción', async () => {
      await service.create(
        'patient-1',
        { ...dto, isPayer: true },
        'therapist-1',
      );

      expect(prisma.legalGuardian.updateMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1', isPayer: true },
        data: { isPayer: false },
      });
    });

    it('sin isPayer no toca a los demás pagadores', async () => {
      await service.create('patient-1', dto, 'therapist-1');

      expect(prisma.legalGuardian.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.legalGuardian.findFirst.mockResolvedValue(buildGuardian());
    });

    it('devuelve 404 si el representante no es de ese paciente', async () => {
      prisma.legalGuardian.findFirst.mockResolvedValue(null);

      await expect(
        service.update('patient-1', 'guardian-x', { canConsent: false }, 't'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.legalGuardian.findFirst).toHaveBeenCalledWith({
        where: { id: 'guardian-x', patientId: 'patient-1' },
      });
      expect(prisma.legalGuardian.update).not.toHaveBeenCalled();
    });

    it('normaliza el RUT cuando viene y actualiza solo los campos enviados', async () => {
      await service.update(
        'patient-1',
        'guardian-1',
        { rut: '9.876.543-3', canConsent: false },
        'therapist-1',
      );

      expect(prisma.legalGuardian.update).toHaveBeenCalledWith({
        where: { id: 'guardian-1' },
        data: { rut: '9876543-3', canConsent: false },
      });
    });

    it('bloquea al paciente antes de leer el representante', async () => {
      const order: string[] = [];
      prisma.$queryRaw.mockImplementation(() => {
        order.push('lock');
        return Promise.resolve([{ id: 'patient-1' }]);
      });
      prisma.legalGuardian.findFirst.mockImplementation(() => {
        order.push('find');
        return Promise.resolve(buildGuardian());
      });

      await service.update('patient-1', 'guardian-1', {}, 'therapist-1');

      expect(order).toEqual(['lock', 'find']);
    });

    it('al marcar isPayer, desmarca a los otros representantes', async () => {
      await service.update(
        'patient-1',
        'guardian-1',
        { isPayer: true },
        'therapist-1',
      );

      expect(prisma.legalGuardian.updateMany).toHaveBeenCalledWith({
        where: {
          patientId: 'patient-1',
          isPayer: true,
          id: { not: 'guardian-1' },
        },
        data: { isPayer: false },
      });
    });

    it('al desmarcar isPayer no toca a los demás', async () => {
      await service.update(
        'patient-1',
        'guardian-1',
        { isPayer: false },
        'therapist-1',
      );

      expect(prisma.legalGuardian.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      prisma.legalGuardian.findFirst.mockResolvedValue(buildGuardian());
    });

    it('elimina el representante sin consentimientos asociados', async () => {
      await service.remove('patient-1', 'guardian-1', 'therapist-1');

      expect(prisma.patientConsent.count).toHaveBeenCalledWith({
        where: { guardianId: 'guardian-1' },
      });
      expect(prisma.legalGuardian.delete).toHaveBeenCalledWith({
        where: { id: 'guardian-1' },
      });
    });

    it('devuelve 404 si el representante no es de ese paciente', async () => {
      prisma.legalGuardian.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('patient-1', 'guardian-x', 'therapist-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.legalGuardian.delete).not.toHaveBeenCalled();
    });

    it('devuelve 409 con mensaje claro si algún consentimiento lo referencia', async () => {
      prisma.patientConsent.count.mockResolvedValue(1);

      await expect(
        service.remove('patient-1', 'guardian-1', 'therapist-1'),
      ).rejects.toThrow(
        new ConflictException(
          'No se puede eliminar al representante porque tiene consentimientos registrados a su nombre',
        ),
      );
      expect(prisma.legalGuardian.delete).not.toHaveBeenCalled();
    });

    it('traduce la violación de FK (P2003) por un consentimiento concurrente a 409', async () => {
      prisma.legalGuardian.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('fk', {
          code: 'P2003',
          clientVersion: 'x',
        }),
      );

      await expect(
        service.remove('patient-1', 'guardian-1', 'therapist-1'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
