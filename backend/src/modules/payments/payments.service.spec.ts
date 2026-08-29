import { Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGatewayClient } from './payment-gateway.client';

interface ConsultationRow {
  id: string;
  groupId: string;
  patientId: string;
  therapistId: string;
  sessionDate: Date;
  patient: {
    id: string;
    defaultSessionAmount: number | null;
    deletedAt: Date | null;
  };
}

function buildConsultation(
  overrides: Partial<ConsultationRow> = {},
  patientOverrides: Partial<ConsultationRow['patient']> = {},
): ConsultationRow {
  return {
    id: 'consultation-1',
    groupId: 'group-1',
    patientId: 'patient-1',
    therapistId: 'therapist-1',
    sessionDate: new Date('2026-09-10T15:00:00.000Z'),
    patient: {
      id: 'patient-1',
      defaultSessionAmount: 30000,
      deletedAt: null,
      ...patientOverrides,
    },
    ...overrides,
  };
}

function buildAccount(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'account-1',
    therapistId: 'therapist-1',
    status: 'CONNECTED',
    merchantId: 'merchant-1',
    ...overrides,
  };
}

function buildPayment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'payment-1',
    groupId: 'group-1',
    patientId: 'patient-1',
    therapistId: 'therapist-1',
    amount: 30000,
    status: 'PENDING',
    dueDate: new Date('2026-09-10T15:00:00.000Z'),
    gatewayToken: null,
    paymentUrl: null,
    ...overrides,
  };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: {
    consultation: { findFirst: jest.Mock };
    paymentAccount: { findUnique: jest.Mock };
    payment: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
  let gateway: {
    createMerchant: jest.Mock;
    createOrder: jest.Mock;
    getOrderStatus: jest.Mock;
    verifyCallbackSignature: jest.Mock;
  };
  let config: { get: jest.Mock };

  function buildService(enabled = true): PaymentsService {
    config = {
      get: jest.fn((key: string) => {
        if (key === 'PAYMENTS_ENABLED') return enabled ? undefined : 'false';
        return undefined;
      }),
    };
    return new PaymentsService(
      prisma as unknown as PrismaService,
      gateway as unknown as PaymentGatewayClient,
      config as unknown as ConfigService,
    );
  }

  beforeEach(() => {
    prisma = {
      consultation: { findFirst: jest.fn() },
      paymentAccount: { findUnique: jest.fn() },
      payment: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };
    gateway = {
      createMerchant: jest.fn(),
      createOrder: jest.fn().mockResolvedValue({
        token: 'order-token',
        paymentUrl: 'https://flow.cl/pay/order-token',
      }),
      getOrderStatus: jest.fn(),
      verifyCallbackSignature: jest.fn(),
    };
    service = buildService(true);
  });

  describe('ensureCharge', () => {
    // spec.md "Feature Flag Gating" + "Automatic Charge Creation Gated by
    // Gateway Connection" + "Charge Amount Resolution": ninguna de las tres
    // condiciones de gating crea un cargo.
    it.each([
      ['PAYMENTS_ENABLED=false', () => (service = buildService(false)), {}],
      [
        'sin PaymentAccount conectada',
        () => prisma.paymentAccount.findUnique.mockResolvedValue(null),
        {},
      ],
      [
        'defaultSessionAmount ausente',
        () => undefined,
        { defaultSessionAmount: null },
      ],
    ])('no crea cargo cuando %s', async (_label, arrange, patientOverrides) => {
      prisma.consultation.findFirst.mockResolvedValue(
        buildConsultation({}, patientOverrides as never),
      );
      prisma.paymentAccount.findUnique.mockResolvedValue(buildAccount());
      prisma.payment.findUnique.mockResolvedValue(null);
      arrange();

      await service.ensureCharge('group-1');

      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(gateway.createOrder).not.toHaveBeenCalled();
    });

    it('crea un cargo PENDING con el amount snapshot del paciente cuando el gating pasa', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.paymentAccount.findUnique.mockResolvedValue(buildAccount());
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.payment.create.mockResolvedValue(buildPayment());

      await service.ensureCharge('group-1');

      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          groupId: 'group-1',
          patientId: 'patient-1',
          therapistId: 'therapist-1',
          amount: 30000,
          status: 'PENDING',
          dueDate: new Date('2026-09-10T15:00:00.000Z'),
        }) as unknown,
      });
    });

    it('llama a gateway.createOrder y guarda token/paymentUrl tras crear el cargo', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.paymentAccount.findUnique.mockResolvedValue(buildAccount());
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.payment.create.mockResolvedValue(buildPayment());

      await service.ensureCharge('group-1');

      expect(gateway.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          merchantId: 'merchant-1',
          amount: 30000,
          externalId: 'group-1',
        }) as unknown,
      );
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({
          gatewayToken: 'order-token',
          paymentUrl: 'https://flow.cl/pay/order-token',
        }) as unknown,
      });
    });

    // spec.md "Payment Identity Keyed by Consultation Group" (Correction
    // updates the same charge and moves its due date): un cargo existente
    // nunca se re-crea ni re-snapshotea el amount.
    it('si ya existe un cargo para ese groupId, solo mueve dueDate y nunca toca amount', async () => {
      prisma.consultation.findFirst.mockResolvedValue(
        buildConsultation({
          sessionDate: new Date('2026-10-01T15:00:00.000Z'),
        }),
      );
      prisma.paymentAccount.findUnique.mockResolvedValue(buildAccount());
      prisma.payment.findUnique.mockResolvedValue(
        buildPayment({ dueDate: new Date('2026-09-10T15:00:00.000Z') }),
      );

      await service.ensureCharge('group-1');

      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(gateway.createOrder).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: { dueDate: new Date('2026-10-01T15:00:00.000Z') },
      });
    });

    // spec.md "Charge Amount Resolution and Snapshot": "later edits to
    // defaultSessionAmount do not affect it" -- un cargo existente ignora
    // por completo el defaultSessionAmount actual del paciente.
    it('un cargo existente no se ve afectado por un cambio posterior de defaultSessionAmount', async () => {
      prisma.consultation.findFirst.mockResolvedValue(
        buildConsultation({}, { defaultSessionAmount: 99999 }),
      );
      prisma.paymentAccount.findUnique.mockResolvedValue(buildAccount());
      prisma.payment.findUnique.mockResolvedValue(
        buildPayment({
          amount: 30000,
          dueDate: new Date('2026-09-10T15:00:00.000Z'),
        }),
      );

      await service.ensureCharge('group-1');

      expect(prisma.payment.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: expect.anything() as unknown,
          }) as unknown,
        }),
      );
    });

    it('un cargo existente cuyo dueDate no cambió no dispara ningún update', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.paymentAccount.findUnique.mockResolvedValue(buildAccount());
      prisma.payment.findUnique.mockResolvedValue(
        buildPayment({ dueDate: new Date('2026-09-10T15:00:00.000Z') }),
      );

      await service.ensureCharge('group-1');

      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    // design.md "Data Flow" + Phase 3 (T3.7/T3.8): un gateway que rechaza
    // toda llamada no debe impedir que ensureCharge() se resuelva -- el
    // fire-and-forget en ConsultationsService depende de esto.
    it('un rechazo de gateway.createOrder no impide que ensureCharge se resuelva', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.paymentAccount.findUnique.mockResolvedValue(buildAccount());
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.payment.create.mockResolvedValue(buildPayment());
      gateway.createOrder.mockRejectedValue(new Error('Flow no disponible'));

      await expect(service.ensureCharge('group-1')).resolves.toBeUndefined();
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({
          lastError: 'Flow no disponible',
        }) as unknown,
      });
    });

    it('no hace nada si la consulta no existe o el paciente fue eliminado', async () => {
      prisma.consultation.findFirst.mockResolvedValue(null);

      await service.ensureCharge('group-1');

      expect(prisma.paymentAccount.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('updateAmount', () => {
    it('actualiza el amount de un cargo PENDING existente (override de sesión)', async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.findUniqueOrThrow.mockResolvedValue(
        buildPayment({ amount: 45000, therapistId: 'therapist-1' }),
      );
      prisma.paymentAccount.findUnique.mockResolvedValue(buildAccount());

      const result = await service.updateAmount('group-1', 45000);

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { groupId: 'group-1', status: 'PENDING' },
        data: { amount: 45000 },
      });
      expect(result.amount).toBe(45000);
    });

    it('lanza NotFoundException si no hay un cargo PENDING para ese groupId', async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.updateAmount('group-1', 45000)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // T3.10: mismo criterio de degradación que MailService sin
  // RESEND_API_KEY -- sin PAYMENTS_ENABLED (o explícitamente "false") el
  // servicio se construye sin lanzar y deja constancia en logs, en vez de
  // romper el arranque del módulo.
  describe('boot sin flujo de pagos configurado', () => {
    it('con PAYMENTS_ENABLED="false" el servicio se construye sin lanzar y loguea un warning', () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      expect(() => buildService(false)).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('PAYMENTS_ENABLED') as unknown,
      );

      warnSpy.mockRestore();
    });
  });

  describe('cancelUnpaid', () => {
    // spec.md "Cancellation Preserves Paid Charges and Voids Pending Ones"
    it('cancela un cargo PENDING o LATE', async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      await service.cancelUnpaid('group-1');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { groupId: 'group-1', status: { in: ['PENDING', 'LATE'] } },
        data: expect.objectContaining({ status: 'CANCELLED' }) as unknown,
      });
    });

    it('nunca toca un cargo PAID (fuera del where, nunca se actualiza)', async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await service.cancelUnpaid('group-1');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: expect.not.arrayContaining(['PAID']) as unknown },
          }) as unknown,
        }) as unknown,
      );
    });
  });
});
