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
      findFirst: jest.Mock;
      findMany: jest.Mock;
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
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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

    // sdd/online-payment-integration PR 2 (T6.3): design.md "Reschedule to
    // future runs the inverse gated update (LATE -> PENDING, clearing
    // lateNotifiedAt), re-arming a genuinely new late event."
    it('un cargo LATE cuyo dueDate se mueve al futuro se re-arma a PENDING y limpia lateNotifiedAt', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      prisma.consultation.findFirst.mockResolvedValue(
        buildConsultation({ sessionDate: futureDate }),
      );
      prisma.paymentAccount.findUnique.mockResolvedValue(buildAccount());
      prisma.payment.findUnique.mockResolvedValue(
        buildPayment({
          status: 'LATE',
          dueDate: new Date('2026-07-01T15:00:00.000Z'),
          lateNotifiedAt: new Date('2026-07-01T15:05:00.000Z'),
        }),
      );

      await service.ensureCharge('group-1');

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: { dueDate: futureDate, status: 'PENDING', lateNotifiedAt: null },
      });
    });

    it('un cargo LATE cuyo nuevo dueDate sigue en el pasado solo mueve dueDate, sin re-armarse', async () => {
      const stillPastDate = new Date('2026-08-15T15:00:00.000Z');
      prisma.consultation.findFirst.mockResolvedValue(
        buildConsultation({ sessionDate: stillPastDate }),
      );
      prisma.paymentAccount.findUnique.mockResolvedValue(buildAccount());
      prisma.payment.findUnique.mockResolvedValue(
        buildPayment({
          status: 'LATE',
          dueDate: new Date('2026-07-01T15:00:00.000Z'),
        }),
      );

      await service.ensureCharge('group-1');

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: { dueDate: stillPastDate },
      });
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

  // sdd/online-payment-integration PR 2 (T5.7): design.md "The confirmation
  // callback is a signal, never a source of truth" -- confirm() nunca recibe
  // ni confía en el status que trajo el POST; siempre re-consulta
  // getOrderStatus con el token guardado y aplica el mismo gate
  // updateMany(status in [PENDING, LATE]) que el resto del módulo. La
  // verificación de firma (verifyCallbackSignature) vive en el controller
  // (T5.6), NUNCA acá -- este método asume que ya se llamó con un token
  // legítimo.
  describe('confirm', () => {
    it('confirma un cargo PENDING cuando el gateway re-consultado reporta PAID', async () => {
      prisma.payment.findFirst.mockResolvedValue(
        buildPayment({
          id: 'payment-1',
          status: 'PENDING',
          gatewayToken: 'flow-token',
        }),
      );
      gateway.getOrderStatus.mockResolvedValue({
        status: 'PAID',
        gatewayPaymentId: 'flow-payment-1',
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      await service.confirm('flow-token');

      expect(gateway.getOrderStatus).toHaveBeenCalledWith('flow-token');
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: { in: ['PENDING', 'LATE'] } },
        data: expect.objectContaining({
          status: 'PAID',
          gatewayPaymentId: 'flow-payment-1',
          paidAt: expect.any(Date) as unknown,
        }) as unknown,
      });
    });

    it('un token que no corresponde a ningún cargo no hace nada (no llama al gateway)', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await service.confirm('token-inexistente');

      expect(gateway.getOrderStatus).not.toHaveBeenCalled();
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    // T7.3: "replayed confirm affects 0 rows; PAID -> PAID no-op" -- un
    // cargo ya PAID ni siquiera vuelve a llamar al gateway (idempotencia sin
    // trabajo redundante).
    it('un cargo ya PAID es un no-op (replay) sin volver a consultar el gateway', async () => {
      prisma.payment.findFirst.mockResolvedValue(
        buildPayment({ status: 'PAID' }),
      );

      await service.confirm('flow-token');

      expect(gateway.getOrderStatus).not.toHaveBeenCalled();
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    // T7.3: "CANCELLED never becomes PAID".
    it('un cargo CANCELLED nunca pasa a PAID', async () => {
      prisma.payment.findFirst.mockResolvedValue(
        buildPayment({ status: 'CANCELLED' }),
      );

      await service.confirm('flow-token');

      expect(gateway.getOrderStatus).not.toHaveBeenCalled();
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('si el gateway re-consultado todavía reporta PENDING, no actualiza nada', async () => {
      prisma.payment.findFirst.mockResolvedValue(
        buildPayment({ status: 'PENDING', gatewayToken: 'flow-token' }),
      );
      gateway.getOrderStatus.mockResolvedValue({ status: 'PENDING' });

      await service.confirm('flow-token');

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });
  });

  // T7.7/T7.8: tenancy -- PATCH /payments/:groupId (payments.controller.ts)
  // usa este método para resolver 404 uniforme antes de llamar a
  // updateAmount, nunca un 403-with-leak que revele que el cargo existe pero
  // es de otro terapeuta.
  describe('assertOwnership', () => {
    it('devuelve el cargo cuando pertenece al terapeuta', async () => {
      const payment = buildPayment({ therapistId: 'therapist-1' });
      prisma.payment.findFirst.mockResolvedValue(payment);

      const result = await service.assertOwnership('group-1', 'therapist-1');

      expect(result).toBe(payment);
      expect(prisma.payment.findFirst).toHaveBeenCalledWith({
        where: { groupId: 'group-1', therapistId: 'therapist-1' },
      });
    });

    it('lanza NotFoundException (404 uniforme) si el cargo es de otro terapeuta o no existe', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(
        service.assertOwnership('group-1', 'therapist-2'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // sdd/online-payment-integration PR 2 (T6.1-6.3): @Cron sweep -- pass 1
  // (transición PENDING -> LATE) y pass 2 (reconciliación de callbacks
  // perdidos), "transición + reconcile únicamente" (design.md "Migration /
  // Rollout" table) -- sin notificación todavía (PR 3, T8.4).
  describe('sweep', () => {
    beforeEach(() => {
      prisma.payment.findMany.mockResolvedValue([]);
    });

    it('respeta PAYMENTS_ENABLED=false (no-op completo)', async () => {
      service = buildService(false);

      await service.sweep();

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.payment.findMany).not.toHaveBeenCalled();
    });

    it('transiciona a LATE los cargos PENDING vencidos (pass 1, count-gated por WHERE)', async () => {
      await service.sweep();

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          dueDate: { lte: expect.any(Date) as unknown },
        },
        data: { status: 'LATE' },
      });
    });

    // T7.5 (RED): el WHERE de pass 1 excluye status !== 'PENDING' por
    // construcción -- una segunda corrida sobre un cargo ya LATE queda fuera
    // de ese WHERE y por lo tanto afecta 0 filas, sin necesitar lógica
    // adicional (mismo criterio que cancelUnpaid: la garantía está en el
    // WHERE, no en un chequeo explícito).
    it('el WHERE de pass 1 nunca incluye cargos que no estén en PENDING', async () => {
      await service.sweep();

      const [pass1Call] = prisma.payment.updateMany.mock.calls.find(
        (call: [{ data?: { status?: string } }]) =>
          call[0].data?.status === 'LATE',
      ) as [{ where: { status: string } }];
      expect(pass1Call.where.status).toBe('PENDING');
    });

    it('pass 2 reconcilia un cargo PENDING con token viejo y lo marca PAID si el gateway confirma', async () => {
      const stalePayment = buildPayment({
        id: 'payment-stale',
        status: 'PENDING',
        gatewayToken: 'flow-token-stale',
      });
      prisma.payment.findMany.mockResolvedValue([stalePayment]);
      gateway.getOrderStatus.mockResolvedValue({
        status: 'PAID',
        gatewayPaymentId: 'flow-payment-stale',
      });

      await service.sweep();

      expect(gateway.getOrderStatus).toHaveBeenCalledWith('flow-token-stale');
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-stale', status: { in: ['PENDING', 'LATE'] } },
        data: expect.objectContaining({ status: 'PAID' }) as unknown,
      });
    });

    it('pass 2 no modifica un cargo cuyo gateway re-consultado todavía reporta PENDING', async () => {
      const stalePayment = buildPayment({
        id: 'payment-stale',
        status: 'PENDING',
        gatewayToken: 'flow-token-stale',
      });
      prisma.payment.findMany.mockResolvedValue([stalePayment]);
      gateway.getOrderStatus.mockResolvedValue({ status: 'PENDING' });

      await service.sweep();

      expect(prisma.payment.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'payment-stale' }) as unknown,
        }) as unknown,
      );
    });

    it('pass 2 batchea la consulta de candidatos con take: SWEEP_BATCH_LIMIT', async () => {
      await service.sweep();

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }) as unknown,
      );
    });
  });
});
