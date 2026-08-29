import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Payment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGatewayClient } from './payment-gateway.client';
import {
  PAYMENT_CONFIRM_PATH,
  PAYMENT_RETURN_PATH,
  RECONCILE_MIN_AGE_MS,
  SWEEP_BATCH_LIMIT,
} from './payments.constants';

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';
// T5.6: default local del backend (mismo puerto por default que main.ts,
// process.env.PORT || 3001) -- en despliegue real, BACKEND_PUBLIC_URL debe
// apuntar a la URL pública HTTPS donde Flow puede alcanzar el servidor.
const DEFAULT_BACKEND_URL = 'http://localhost:3001';
const DEFAULT_CURRENCY = 'CLP';
const CHARGE_SUBJECT = 'Sesión clínica';

// spec.md "Cancellation Preserves Paid Charges and Voids Pending Ones": los
// dos únicos estados desde los que un cargo puede cancelarse -- un PAID
// nunca entra a este where, así que updateMany() lo deja bit a bit idéntico
// (mismo patrón que updateMany count-gated de CalendarSyncService.
// handleInvalidGrant).
const CANCELLABLE_STATUSES = ['PENDING', 'LATE'] as const;

// design.md "Technical Approach": PaymentsService es el único dueño del
// ciclo de vida del cargo (ensureCharge/updateAmount/cancelUnpaid en PR 1;
// confirm/sweep llegan en PR 2). ConsultationsService dispara ensureCharge
// fire-and-forget tras create()/correct() -- ninguna falla acá puede
// bloquear ni revertir la escritura clínica que lo origina (spec.md
// "Feature Flag Gating", design.md "Nothing in this module can fail a
// clinical write").
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly enabled: boolean;

  constructor(
    private prisma: PrismaService,
    private gateway: PaymentGatewayClient,
    private config: ConfigService,
  ) {
    // Ausente => habilitado por default, mismo criterio que
    // RemindersService/CalendarSyncService -- solo "false" explícito
    // desactiva la creación de cargos.
    this.enabled = this.config.get<string>('PAYMENTS_ENABLED') !== 'false';

    // T3.10: mismo criterio de degradación que MailService sin
    // RESEND_API_KEY -- el módulo se registra y arranca igual, sin romper
    // el boot de la app ni de los tests.
    if (!this.enabled) {
      this.logger.warn(
        'PAYMENTS_ENABLED="false": el flujo de cobro en línea queda deshabilitado (no se crean cargos, no se envían emails, no se procesan callbacks).',
      );
    }
  }

  // design.md "Decision: Payment keyed on groupId, amount snapshotted at
  // creation": único punto de entrada llamado tanto tras create() como tras
  // correct() (ConsultationsService.emitPaymentCharge, mismo groupId en
  // ambos casos porque groupId es invariante a través de la cadena de
  // versiones). Si el cargo ya existe, nunca se re-crea ni se re-snapshotea
  // el amount -- solo se mueve dueDate si el sessionDate vigente cambió
  // (spec.md "Correction updates the same charge and moves its due date").
  async ensureCharge(groupId: string): Promise<void> {
    if (!this.enabled) return;

    const consultation = await this.prisma.consultation.findFirst({
      where: { groupId, correctedBy: null, deletedAt: null },
      include: {
        patient: {
          select: { id: true, defaultSessionAmount: true, deletedAt: true },
        },
      },
    });
    if (!consultation || consultation.patient.deletedAt) return;

    const account = await this.prisma.paymentAccount.findUnique({
      where: { therapistId: consultation.therapistId },
    });
    if (!account || account.status !== 'CONNECTED') return;

    const existing = await this.prisma.payment.findUnique({
      where: { groupId },
    });

    if (existing) {
      await this.moveDueDateIfNeeded(existing, consultation.sessionDate);
      return;
    }

    // spec.md "Charge Amount Resolution and Snapshot": sin monto resolvible
    // (ni override de sesión -- PATCH /payments/:groupId, PR 2 -- ni
    // defaultSessionAmount) no se crea cargo. La precedencia del override
    // de sesión se implementa como una actualización posterior vía
    // updateAmount(), nunca como parámetro de este método (mismo criterio
    // que el snapshot: el override, una vez aplicado, tampoco se pisa acá).
    const amount = consultation.patient.defaultSessionAmount;
    if (amount === null || amount === undefined) return;

    const created = await this.prisma.payment.create({
      data: {
        groupId,
        patientId: consultation.patientId,
        therapistId: consultation.therapistId,
        amount,
        status: 'PENDING',
        dueDate: consultation.sessionDate,
      },
    });

    await this.issueOrder(created.id, account.merchantId, amount, groupId);
  }

  // T6.3 + design.md "Reschedule to future runs the inverse gated update
  // (LATE -> PENDING, clearing lateNotifiedAt), re-arming a genuinely new
  // late event": un cargo LATE cuyo dueDate se mueve a una fecha futura
  // vuelve a PENDING y limpia lateNotifiedAt, para que sweep() (T6.1) pueda
  // volver a transicionarlo (y, en PR 3, volver a notificar) como un evento
  // de mora genuinamente nuevo. Mover dueDate a otra fecha que sigue en el
  // pasado NO re-arma nada -- el cargo sigue LATE.
  private async moveDueDateIfNeeded(
    existing: Payment,
    sessionDate: Date,
  ): Promise<void> {
    if (existing.status !== 'PENDING' && existing.status !== 'LATE') return;
    if (existing.dueDate.getTime() === sessionDate.getTime()) return;

    const isRescheduleToFuture =
      existing.status === 'LATE' && sessionDate.getTime() > Date.now();

    await this.prisma.payment.update({
      where: { id: existing.id },
      data: {
        dueDate: sessionDate,
        ...(isRescheduleToFuture
          ? { status: 'PENDING' as const, lateNotifiedAt: null }
          : {}),
      },
    });
  }

  // design.md "PATCH /payments/:groupId ... Per-session amount override
  // while PENDING, re-issues order + link" -- expuesto acá desde PR 1 como
  // el método de servicio; el controller (PR 2, task 5.5) solo lo invoca.
  async updateAmount(groupId: string, amount: number): Promise<Payment> {
    const result = await this.prisma.payment.updateMany({
      where: { groupId, status: 'PENDING' },
      data: { amount },
    });
    if (result.count === 0) {
      throw new NotFoundException(
        'No existe un cargo pendiente para esta sesión.',
      );
    }

    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { groupId },
    });

    const account = await this.prisma.paymentAccount.findUnique({
      where: { therapistId: payment.therapistId },
    });
    if (account) {
      await this.issueOrder(payment.id, account.merchantId, amount, groupId);
    }

    return this.prisma.payment.findUniqueOrThrow({ where: { groupId } });
  }

  // spec.md "Cancellation Preserves Paid Charges and Voids Pending Ones":
  // updateMany con status: { in: CANCELLABLE_STATUSES } es la propia
  // garantía -- un cargo PAID queda fuera del where, así que jamás se
  // toca (nunca hace falta un chequeo explícito "si está PAID, no hagas
  // nada").
  async cancelUnpaid(groupId: string): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { groupId, status: { in: [...CANCELLABLE_STATUSES] } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }

  // T5.7 + design.md "The confirmation callback is a signal, never a source
  // of truth": este método NUNCA recibe ni confía en el status que trajo el
  // POST público -- payments.controller.ts (T5.6) ya validó la firma HMAC
  // ANTES de llamar acá, pero confirm() igual re-consulta getOrderStatus con
  // el token guardado como única fuente de verdad. El gate
  // updateMany(status in CANCELLABLE_STATUSES) es la misma garantía de
  // idempotencia que cancelUnpaid: un cargo ya PAID o CANCELLED queda fuera
  // del where (spec.md "Replayed webhook is a no-op" / "CANCELLED never
  // becomes PAID") -- devuelto temprano ANTES de llamar al gateway, para no
  // gastar una consulta de red en un replay.
  async confirm(token: string): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { gatewayToken: token },
    });
    if (!payment) return;
    if (!(CANCELLABLE_STATUSES as readonly string[]).includes(payment.status)) {
      return;
    }

    const orderStatus = await this.gateway.getOrderStatus(token);
    if (orderStatus.status !== 'PAID') return;

    await this.prisma.payment.updateMany({
      where: { id: payment.id, status: { in: [...CANCELLABLE_STATUSES] } },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        gatewayPaymentId: orderStatus.gatewayPaymentId,
      },
    });
  }

  // T5.4/T5.5/T7.7/T7.8: usado por PaymentsController.updateAmount (PATCH
  // /payments/:groupId, scoped por @CurrentUser()) para resolver un 404
  // uniforme -- terapeuta B pidiendo el groupId de terapeuta A recibe
  // exactamente el mismo NotFoundException que un groupId inexistente,
  // nunca un 403-with-leak que confirme que el recurso existe (mismo
  // criterio que PatientsService.assertAccess).
  async assertOwnership(
    groupId: string,
    therapistId: string,
  ): Promise<Payment> {
    const payment = await this.prisma.payment.findFirst({
      where: { groupId, therapistId },
    });
    if (!payment) {
      throw new NotFoundException('No existe un cargo para esta sesión.');
    }
    return payment;
  }

  // design.md "Decision: One PaymentGatewayClient port": createOrder puede
  // rechazar (PR 1 provee UnconfiguredPaymentGatewayClient por default, que
  // rechaza siempre) sin que eso impida que ensureCharge()/updateAmount()
  // se resuelvan -- el cargo queda PENDING sin gatewayToken/paymentUrl, y
  // el reconciler/reintento manual lo completa más adelante (PR 2).
  private async issueOrder(
    paymentId: string,
    merchantId: string | null,
    amount: number,
    groupId: string,
  ): Promise<void> {
    if (!merchantId) return;

    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? DEFAULT_FRONTEND_URL;
    const backendUrl =
      this.config.get<string>('BACKEND_PUBLIC_URL') ?? DEFAULT_BACKEND_URL;

    try {
      const order = await this.gateway.createOrder({
        merchantId,
        amount,
        currency: DEFAULT_CURRENCY,
        subject: CHARGE_SUBJECT,
        externalId: groupId,
        // returnUrl es dónde Flow devuelve al PACIENTE tras el checkout
        // hospedado (frontend) -- confirmUrl es dónde Flow hace el POST
        // servidor-a-servidor (backend, sin guard, T5.6). Nunca la misma
        // URL: PR 1 dejó ambas apuntando al frontend como placeholder
        // porque la ruta pública del backend todavía no existía (ver
        // apply-progress de PR 1) -- corregido acá ahora que
        // payments.controller.ts ya existe.
        returnUrl: `${frontendUrl}${PAYMENT_RETURN_PATH}`,
        confirmUrl: `${backendUrl}${PAYMENT_CONFIRM_PATH}`,
      });
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          gatewayToken: order.token,
          paymentUrl: order.paymentUrl,
          orderIssuedAt: new Date(),
          lastError: null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Fallo al crear la orden de pago (paymentId=${paymentId}, groupId=${groupId}): ${message}`,
      );
      await this.prisma.payment
        .update({ where: { id: paymentId }, data: { lastError: message } })
        .catch(() => undefined);
    }
  }

  // T6.1-6.2 + design.md "Data Flow": mismo shape que
  // CalendarSyncService.reconcile -- dos pasadas independientes, ninguna
  // notifica todavía (PR 3, T8.4: "transición + reconcile únicamente" en
  // este PR). @nestjs/schedule's EVERY_30_MINUTES cubre exactamente la
  // cadencia de design.md ("@Cron(EVERY_30_MINUTES) sweep()").
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    if (!this.enabled) return;

    await this.transitionLatePayments();
    await this.reconcilePendingPayments();
  }

  // T6.1: bulk updateMany, no por-fila -- sin notificación en este PR
  // (T8.4, PR 3) no hace falta reclamar cada fila individualmente; el WHERE
  // (status: 'PENDING') es la propia garantía de "count-gated" (T7.5: una
  // segunda corrida sobre un cargo ya LATE queda fuera del WHERE, 0 filas
  // afectadas).
  private async transitionLatePayments(): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { status: 'PENDING', dueDate: { lte: new Date() } },
      data: { status: 'LATE' },
    });
  }

  // T6.2: reconciliación de callbacks perdidos -- candidatos con token
  // emitido hace más de RECONCILE_MIN_AGE_MS, batcheados a
  // SWEEP_BATCH_LIMIT por corrida (mismo patrón de reconcile acotado que
  // CalendarSyncService.repairFailedLinks/backfill). Cada candidato se
  // procesa individualmente porque requiere una llamada de red por fila
  // (gateway.getOrderStatus) -- un fallo aislado no debe abortar el resto
  // del batch.
  private async reconcilePendingPayments(): Promise<void> {
    const cutoff = new Date(Date.now() - RECONCILE_MIN_AGE_MS);
    const candidates = await this.prisma.payment.findMany({
      where: {
        status: { in: [...CANCELLABLE_STATUSES] },
        gatewayToken: { not: null },
        orderIssuedAt: { lte: cutoff },
      },
      take: SWEEP_BATCH_LIMIT,
    });

    for (const payment of candidates) {
      await this.reconcileOne(payment).catch((err: unknown) => {
        this.logger.error(
          `Sweep: fallo al reconciliar paymentId=${payment.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  private async reconcileOne(payment: Payment): Promise<void> {
    if (!payment.gatewayToken) return;

    const orderStatus = await this.gateway.getOrderStatus(payment.gatewayToken);
    if (orderStatus.status !== 'PAID') return;

    await this.prisma.payment.updateMany({
      where: { id: payment.id, status: { in: [...CANCELLABLE_STATUSES] } },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        gatewayPaymentId: orderStatus.gatewayPaymentId,
      },
    });
  }
}
