import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@prisma/client';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GatewayContext, GatewayCredentials } from './payment-gateway.client';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { PaymentAccountService } from './payment-account.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SWEEP_CONCURRENCY } from './payments.constants';

// sdd/online-payment-integration PR 2/3 (T6.1-6.3, T8.4, T10.3-10.4);
// issue #137: extraído de payments.service.spec.ts junto con
// PaymentReconciliationService (mismo describe 'sweep', mismo setup de
// fixtures) -- markPaid ahora es una llamada a PaymentsService en vez de un
// método privado propio, así que se mockea como dependencia inyectada.

function buildContext(overrides: Partial<GatewayContext> = {}): GatewayContext {
  return {
    provider: PaymentProvider.FLOW,
    credentials: new GatewayCredentials('test-api-key', 'test-secret-key'),
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

describe('PaymentReconciliationService', () => {
  let service: PaymentReconciliationService;
  let prisma: {
    patient: { findUnique: jest.Mock };
    payment: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let paymentAccountService: { resolveGatewayContext: jest.Mock };
  let gatewayAdapter: {
    getOrderStatus: jest.Mock;
  };
  let gatewayRegistry: { get: jest.Mock };
  let config: { get: jest.Mock };
  let mailService: { sendLatePaymentEmail: jest.Mock };
  let notificationsService: { create: jest.Mock };
  let paymentsService: { markPaid: jest.Mock };

  function buildService(enabled = true): PaymentReconciliationService {
    config = {
      get: jest.fn((key: string) => {
        if (key === 'PAYMENTS_ENABLED') return enabled ? undefined : 'false';
        return undefined;
      }),
    };
    return new PaymentReconciliationService(
      prisma as unknown as PrismaService,
      paymentAccountService as unknown as PaymentAccountService,
      gatewayRegistry as unknown as PaymentGatewayRegistry,
      config as unknown as ConfigService,
      mailService as unknown as MailService,
      notificationsService as unknown as NotificationsService,
      paymentsService as unknown as PaymentsService,
    );
  }

  let pass1Candidates: unknown[];
  let pass2Candidates: unknown[];

  beforeEach(() => {
    pass1Candidates = [];
    pass2Candidates = [];
    prisma = {
      patient: { findUnique: jest.fn() },
      payment: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    // pass1 y pass2 comparten el mismo `prisma.payment.findMany` mock -- se
    // distinguen por la forma del WHERE (pass2 siempre filtra por
    // gatewayToken), no por orden de invocación, para que cada test pueda
    // fijar candidatos de una sola pasada sin acoplarse a cuál corre primero.
    prisma.payment.findMany.mockImplementation(
      (args: { where: Record<string, unknown> }) =>
        Promise.resolve(
          'gatewayToken' in args.where ? pass2Candidates : pass1Candidates,
        ),
    );
    paymentAccountService = { resolveGatewayContext: jest.fn() };
    gatewayAdapter = { getOrderStatus: jest.fn() };
    gatewayRegistry = { get: jest.fn().mockReturnValue(gatewayAdapter) };
    mailService = {
      sendLatePaymentEmail: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = { create: jest.fn().mockResolvedValue(undefined) };
    paymentsService = { markPaid: jest.fn().mockResolvedValue(undefined) };
    service = buildService(true);
  });

  describe('sweep', () => {
    it('respeta PAYMENTS_ENABLED=false (no-op completo)', async () => {
      service = buildService(false);

      await service.sweep();

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.payment.findMany).not.toHaveBeenCalled();
    });

    it('pass 1 consulta candidatos PENDING vencidos, batcheados a SWEEP_BATCH_LIMIT', async () => {
      await service.sweep();

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          dueDate: { lte: expect.any(Date) as unknown },
        },
        take: 200,
      });
    });

    // T8.4 + spec.md "One-Shot Late-Payment Notification": la transición
    // ganadora (count-gated updateMany, count===1) dispara exactamente un
    // email y una notificación PAYMENT_LATE.
    it('transiciona a LATE un cargo PENDING vencido y notifica exactamente una vez (email + notificación in-app)', async () => {
      const duePayment = buildPayment({
        id: 'payment-due',
        status: 'PENDING',
        patientId: 'patient-1',
        therapistId: 'therapist-1',
        amount: 30000,
      });
      pass1Candidates = [duePayment];
      prisma.payment.updateMany.mockImplementation(
        (args: { where: { status?: string } }) =>
          Promise.resolve({ count: args.where.status === 'PENDING' ? 1 : 0 }),
      );
      prisma.patient.findUnique.mockResolvedValue({
        email: 'paciente@example.com',
        fullName: 'Juan Soto',
      });

      await service.sweep();

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-due', status: 'PENDING' },
        data: { status: 'LATE', lateNotifiedAt: expect.any(Date) as unknown },
      });
      expect(mailService.sendLatePaymentEmail).toHaveBeenCalledTimes(1);
      expect(mailService.sendLatePaymentEmail).toHaveBeenCalledWith(
        'paciente@example.com',
        'Juan Soto',
        30000,
        duePayment.dueDate,
      );
      expect(notificationsService.create).toHaveBeenCalledTimes(1);
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'therapist-1',
          type: 'PAYMENT_LATE',
        }) as unknown,
      );
    });

    // T7.5/T10.3 (RED): el updateMany por fila filtra status: 'PENDING' --
    // un cargo que otro tick/instancia ya transicionó (count 0) no vuelve a
    // notificar.
    it('un cargo que ya no está PENDING (0 filas afectadas) no notifica de nuevo', async () => {
      const alreadyLate = buildPayment({
        id: 'payment-already-late',
        status: 'PENDING', // aparece en el candidate scan, pero el updateMany pierde la carrera
      });
      pass1Candidates = [alreadyLate];
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await service.sweep();

      expect(mailService.sendLatePaymentEmail).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('un cargo sin email de paciente no envía email pero igual crea la notificación in-app', async () => {
      const duePayment = buildPayment({
        id: 'payment-due',
        status: 'PENDING',
        patientId: 'patient-1',
        therapistId: 'therapist-1',
      });
      pass1Candidates = [duePayment];
      prisma.payment.updateMany.mockImplementation(
        (args: { where: { status?: string } }) =>
          Promise.resolve({ count: args.where.status === 'PENDING' ? 1 : 0 }),
      );
      prisma.patient.findUnique.mockResolvedValue({
        email: null,
        fullName: 'Juan Soto',
      });

      await service.sweep();

      expect(mailService.sendLatePaymentEmail).not.toHaveBeenCalled();
      expect(notificationsService.create).toHaveBeenCalledTimes(1);
    });

    it('pass 2 reconcilia un cargo PENDING con token viejo y lo marca PAID si el gateway confirma', async () => {
      const stalePayment = buildPayment({
        id: 'payment-stale',
        status: 'PENDING',
        gatewayToken: 'flow-token-stale',
        therapistId: 'therapist-1',
      });
      pass2Candidates = [stalePayment];
      const context = buildContext();
      paymentAccountService.resolveGatewayContext.mockResolvedValue(context);
      gatewayAdapter.getOrderStatus.mockResolvedValue({
        status: 'PAID',
        gatewayPaymentId: 'flow-payment-stale',
      });

      await service.sweep();

      expect(gatewayAdapter.getOrderStatus).toHaveBeenCalledWith(
        context.credentials,
        'flow-token-stale',
      );
      expect(paymentsService.markPaid).toHaveBeenCalledWith(
        'payment-stale',
        'flow-payment-stale',
      );
    });

    it('pass 2 no reconcilia (ni marca PAID) un cargo cuyo gateway re-consultado todavía reporta PENDING', async () => {
      const stalePayment = buildPayment({
        id: 'payment-stale',
        status: 'PENDING',
        gatewayToken: 'flow-token-stale',
        therapistId: 'therapist-1',
      });
      pass2Candidates = [stalePayment];
      paymentAccountService.resolveGatewayContext.mockResolvedValue(
        buildContext(),
      );
      gatewayAdapter.getOrderStatus.mockResolvedValue({ status: 'PENDING' });

      await service.sweep();

      expect(paymentsService.markPaid).not.toHaveBeenCalled();
    });

    it('pass 2 no reconcilia (ni llama al gateway) un cargo cuya cuenta dueña ya no está conectada', async () => {
      const stalePayment = buildPayment({
        id: 'payment-stale',
        status: 'PENDING',
        gatewayToken: 'flow-token-stale',
        therapistId: 'therapist-1',
      });
      pass2Candidates = [stalePayment];
      paymentAccountService.resolveGatewayContext.mockResolvedValue(null);

      await service.sweep();

      expect(gatewayAdapter.getOrderStatus).not.toHaveBeenCalled();
      expect(paymentsService.markPaid).not.toHaveBeenCalled();
    });

    it('pass 2 batchea la consulta de candidatos con take: SWEEP_BATCH_LIMIT', async () => {
      await service.sweep();

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }) as unknown,
      );
    });

    // sdd/payments-multigateway-redesign task 3.3 + design.md Decision 2:
    // "memoized in a Map local to one run and discarded at the end" -- dos
    // cargos vencidos del mismo terapeuta en el mismo tick de sweep()
    // resuelven el contexto una sola vez.
    it('memoiza el contexto por therapistId dentro de un mismo run (no vuelve a resolver para un segundo cargo del mismo terapeuta)', async () => {
      const stale1 = buildPayment({
        id: 'payment-stale-1',
        status: 'PENDING',
        gatewayToken: 'token-1',
        therapistId: 'therapist-1',
      });
      const stale2 = buildPayment({
        id: 'payment-stale-2',
        status: 'PENDING',
        gatewayToken: 'token-2',
        therapistId: 'therapist-1',
      });
      pass2Candidates = [stale1, stale2];
      paymentAccountService.resolveGatewayContext.mockResolvedValue(
        buildContext(),
      );
      gatewayAdapter.getOrderStatus.mockResolvedValue({ status: 'PENDING' });

      await service.sweep();

      expect(paymentAccountService.resolveGatewayContext).toHaveBeenCalledTimes(
        1,
      );
      expect(gatewayAdapter.getOrderStatus).toHaveBeenCalledTimes(2);
    });

    // issue #115: runInBatches debe correr como máximo SWEEP_CONCURRENCY
    // candidatos en paralelo por chunk, nunca la tanda completa sin límite
    // (lo que saturaría a Flow con hasta SWEEP_BATCH_LIMIT=200 llamadas
    // simultáneas) ni uno por uno (lo que serializa la duración del sweep).
    it('pass 2 procesa como máximo SWEEP_CONCURRENCY candidatos en paralelo', async () => {
      const totalCandidates = SWEEP_CONCURRENCY + 3;
      pass2Candidates = Array.from({ length: totalCandidates }, (_, i) =>
        buildPayment({
          id: `payment-${i}`,
          status: 'PENDING',
          gatewayToken: `token-${i}`,
          therapistId: 'therapist-1',
        }),
      );
      paymentAccountService.resolveGatewayContext.mockResolvedValue(
        buildContext(),
      );

      let inFlight = 0;
      let maxInFlight = 0;
      gatewayAdapter.getOrderStatus.mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight--;
        return { status: 'PENDING' };
      });

      await service.sweep();

      expect(gatewayAdapter.getOrderStatus).toHaveBeenCalledTimes(
        totalCandidates,
      );
      expect(maxInFlight).toBe(SWEEP_CONCURRENCY);
    });
  });
});
