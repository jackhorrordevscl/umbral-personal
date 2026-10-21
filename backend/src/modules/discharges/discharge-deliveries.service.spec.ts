import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DischargeDeliveriesService } from './discharge-deliveries.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateDischargeDeliveryDto } from './dto/create-discharge-delivery.dto';

const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

const ADULT_BIRTH = new Date('1990-05-20T00:00:00.000Z');
const MINOR_BIRTH = new Date('2015-05-20T00:00:00.000Z');

function discharge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dis-1',
    patientId: 'patient-1',
    status: 'ISSUED',
    patient: { fullName: 'Luis Soto', birthDate: ADULT_BIRTH },
    ...overrides,
  };
}

function dto(
  overrides: Partial<CreateDischargeDeliveryDto> = {},
): CreateDischargeDeliveryDto {
  return {
    recipientType: 'PATIENT',
    purpose: 'Entrega en sesión de cierre',
    channel: 'IN_PERSON',
    ...overrides,
  } as CreateDischargeDeliveryDto;
}

describe('DischargeDeliveriesService (T4)', () => {
  let service: DischargeDeliveriesService;
  let prisma: {
    treatmentDischarge: { findFirst: jest.Mock };
    legalGuardian: { findFirst: jest.Mock };
    patientDocument: { findFirst: jest.Mock };
    dischargeDelivery: { create: jest.Mock; findMany: jest.Mock };
  };
  let audit: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      treatmentDischarge: {
        findFirst: jest.fn().mockResolvedValue(discharge()),
      },
      legalGuardian: { findFirst: jest.fn() },
      patientDocument: { findFirst: jest.fn() },
      dischargeDelivery: {
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'del-1', ...data }),
          ),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new DischargeDeliveriesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe('record', () => {
    it('entrega a un paciente adulto: toma el nombre de la ficha y audita sin datos personales', async () => {
      const result = await service.record('dis-1', dto(), 'therapist-1', ctx);

      expect(prisma.treatmentDischarge.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'dis-1',
            therapistId: 'therapist-1',
          }) as unknown,
        }),
      );
      expect(prisma.dischargeDelivery.create).toHaveBeenCalledWith({
        data: {
          dischargeId: 'dis-1',
          recipientType: 'PATIENT',
          recipientName: 'Luis Soto',
          guardianId: null,
          authorizationDocumentId: null,
          authorizationAttested: false,
          purpose: 'Entrega en sesión de cierre',
          channel: 'IN_PERSON',
          recordedById: 'therapist-1',
        },
      });
      expect(result.id).toBe('del-1');
      expect(audit.log).toHaveBeenCalledTimes(1);
      const [[entry]] = audit.log.mock.calls as [
        [
          {
            action: string;
            resource: string;
            resourceId: string;
            userId: string;
            detail: string;
          },
        ],
      ];
      expect(entry).toMatchObject({
        action: 'DISCHARGE_DELIVER',
        resource: 'Discharge',
        resourceId: 'dis-1',
        userId: 'therapist-1',
      });
      expect(entry.detail).not.toContain('Luis Soto');
      expect(entry.detail).not.toContain('Entrega en sesión de cierre');
    });

    it('un informe ajeno o inexistente responde 404 y no escribe', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(null);

      await expect(
        service.record('dis-1', dto(), 'otro-terapeuta', ctx),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.dischargeDelivery.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('un borrador no se puede entregar', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        discharge({ status: 'DRAFT' }),
      );

      await expect(
        service.record('dis-1', dto(), 'therapist-1', ctx),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.dischargeDelivery.create).not.toHaveBeenCalled();
    });

    it('rechaza entregar al paciente si tiene menos de 18 años', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        discharge({
          patient: { fullName: 'Luis Soto', birthDate: MINOR_BIRTH },
        }),
      );

      await expect(
        service.record('dis-1', dto(), 'therapist-1', ctx),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.dischargeDelivery.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('entrega a un representante con acceso a informes y toma su nombre', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(
        discharge({
          patient: { fullName: 'Luis Soto', birthDate: MINOR_BIRTH },
        }),
      );
      prisma.legalGuardian.findFirst.mockResolvedValue({
        id: 'g1',
        fullName: 'María Soto',
      });

      await service.record(
        'dis-1',
        dto({
          recipientType: 'GUARDIAN',
          guardianId: '7b0a7f9e-4c47-4a5e-9c4f-1b2d3e4f5a6b',
        }),
        'therapist-1',
        ctx,
      );

      expect(prisma.legalGuardian.findFirst).toHaveBeenCalledWith({
        where: {
          id: '7b0a7f9e-4c47-4a5e-9c4f-1b2d3e4f5a6b',
          patientId: 'patient-1',
          canAccessReports: true,
        },
        select: { id: true, fullName: true },
      });
      expect(prisma.dischargeDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          recipientType: 'GUARDIAN',
          recipientName: 'María Soto',
          guardianId: 'g1',
        }) as unknown,
      });
    });

    it('rechaza un representante sin acceso a informes o de otro paciente', async () => {
      prisma.legalGuardian.findFirst.mockResolvedValue(null);

      await expect(
        service.record(
          'dis-1',
          dto({
            recipientType: 'GUARDIAN',
            guardianId: '7b0a7f9e-4c47-4a5e-9c4f-1b2d3e4f5a6b',
          }),
          'therapist-1',
          ctx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.dischargeDelivery.create).not.toHaveBeenCalled();
    });

    it('GUARDIAN exige guardianId', async () => {
      await expect(
        service.record(
          'dis-1',
          dto({ recipientType: 'GUARDIAN' }),
          'therapist-1',
          ctx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('un tercero sin autorización registrada no puede recibir la entrega', async () => {
      await expect(
        service.record(
          'dis-1',
          dto({ recipientType: 'THIRD_PARTY', recipientName: 'Colegio Sur' }),
          'therapist-1',
          ctx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.dischargeDelivery.create).not.toHaveBeenCalled();
    });

    it('un tercero exige nombre del destinatario', async () => {
      await expect(
        service.record(
          'dis-1',
          dto({
            recipientType: 'THIRD_PARTY',
            authorizationDocumentId: '7b0a7f9e-4c47-4a5e-9c4f-1b2d3e4f5a6b',
          }),
          'therapist-1',
          ctx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza una autorización que no existe, es de otro paciente, otro tipo o está anulada', async () => {
      prisma.patientDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.record(
          'dis-1',
          dto({
            recipientType: 'THIRD_PARTY',
            recipientName: 'Colegio Sur',
            authorizationDocumentId: '7b0a7f9e-4c47-4a5e-9c4f-1b2d3e4f5a6b',
            authorizationAttested: true,
          }),
          'therapist-1',
          ctx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.patientDocument.findFirst).toHaveBeenCalledWith({
        where: {
          id: '7b0a7f9e-4c47-4a5e-9c4f-1b2d3e4f5a6b',
          patientId: 'patient-1',
          type: 'DELIVERY_AUTHORIZATION',
          voidedAt: null,
        },
        select: { id: true },
      });
      expect(prisma.dischargeDelivery.create).not.toHaveBeenCalled();
    });

    it('entrega a un tercero con autorización válida', async () => {
      prisma.patientDocument.findFirst.mockResolvedValue({ id: 'doc-1' });

      await service.record(
        'dis-1',
        dto({
          recipientType: 'THIRD_PARTY',
          recipientName: 'Colegio Sur',
          authorizationDocumentId: '7b0a7f9e-4c47-4a5e-9c4f-1b2d3e4f5a6b',
          authorizationAttested: true,
          channel: 'EMAIL',
        }),
        'therapist-1',
        ctx,
      );

      expect(prisma.dischargeDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          recipientType: 'THIRD_PARTY',
          recipientName: 'Colegio Sur',
          authorizationDocumentId: 'doc-1',
          authorizationAttested: true,
          channel: 'EMAIL',
        }) as unknown,
      });
      const [[entry]] = audit.log.mock.calls as [[{ detail: string }]];
      expect(entry.detail).toContain('authorizationAttested=true');
    });

    it.each([
      ['sin la declaración', undefined],
      ['con la declaración en false', false],
    ])(
      'un tercero exige que el terapeuta declare haber revisado la autorización: %s',
      async (_name, authorizationAttested) => {
        prisma.patientDocument.findFirst.mockResolvedValue({ id: 'doc-1' });

        await expect(
          service.record(
            'dis-1',
            dto({
              recipientType: 'THIRD_PARTY',
              recipientName: 'Colegio Sur',
              authorizationDocumentId: '7b0a7f9e-4c47-4a5e-9c4f-1b2d3e4f5a6b',
              authorizationAttested,
            }),
            'therapist-1',
            ctx,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.dischargeDelivery.create).not.toHaveBeenCalled();
      },
    );

    it('PATIENT y GUARDIAN se registran sin declaración de autorización (false)', async () => {
      await service.record('dis-1', dto(), 'therapist-1', ctx);

      expect(prisma.dischargeDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          authorizationAttested: false,
        }) as unknown,
      });
    });

    it.each([
      [
        'guardianId con PATIENT',
        dto({ guardianId: '7b0a7f9e-4c47-4a5e-9c4f-1b2d3e4f5a6b' }),
      ],
      [
        'autorización con PATIENT',
        dto({
          authorizationDocumentId: '7b0a7f9e-4c47-4a5e-9c4f-1b2d3e4f5a6b',
        }),
      ],
      ['nombre con PATIENT', dto({ recipientName: 'Otra persona' })],
      ['declaración con PATIENT', dto({ authorizationAttested: true })],
    ])(
      'rechaza campos que no corresponden al tipo: %s',
      async (_name, body) => {
        await expect(
          service.record('dis-1', body, 'therapist-1', ctx),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.dischargeDelivery.create).not.toHaveBeenCalled();
      },
    );

    it('un fallo del log de auditoría no deshace la entrega ya registrada', async () => {
      audit.log.mockRejectedValue(new Error('audit down'));

      await expect(
        service.record('dis-1', dto(), 'therapist-1', ctx),
      ).resolves.toMatchObject({ id: 'del-1' });
    });
  });

  describe('list', () => {
    it('lista las entregas de un informe propio, la más reciente primero', async () => {
      await service.list('dis-1', 'therapist-1');

      expect(prisma.dischargeDelivery.findMany).toHaveBeenCalledWith({
        where: { dischargeId: 'dis-1' },
        orderBy: { deliveredAt: 'desc' },
      });
    });

    it('un informe ajeno responde 404', async () => {
      prisma.treatmentDischarge.findFirst.mockResolvedValue(null);

      await expect(
        service.list('dis-1', 'otro-terapeuta'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.dischargeDelivery.findMany).not.toHaveBeenCalled();
    });
  });
});
