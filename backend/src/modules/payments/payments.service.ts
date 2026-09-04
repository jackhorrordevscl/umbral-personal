import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType, Payment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGatewayClient } from './payment-gateway.client';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PAYMENT_CONFIRM_PATH,
  PAYMENT_RETURN_PATH,
  RECONCILE_MIN_AGE_MS,
  SWEEP_BATCH_LIMIT,
} from './payments.constants';

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';
// T5.6: local backend default (same default port as main.ts,
// process.env.PORT || 3001) -- in a real deployment, BACKEND_PUBLIC_URL must
// point to the public HTTPS URL where Flow can reach the server.
const DEFAULT_BACKEND_URL = 'http://localhost:3001';
const DEFAULT_CURRENCY = 'CLP';
const CHARGE_SUBJECT = 'Sesión clínica';

// spec.md "Cancellation Preserves Paid Charges and Voids Pending Ones": the
// only two states from which a charge can be cancelled -- a PAID charge
// never enters this where, so updateMany() leaves it bit-for-bit identical
// (same count-gated updateMany pattern as CalendarSyncService.
// handleInvalidGrant).
const CANCELLABLE_STATUSES = ['PENDING', 'LATE'] as const;

// design.md "Technical Approach": PaymentsService is the sole owner of the
// charge lifecycle (ensureCharge/updateAmount/cancelUnpaid in PR 1;
// confirm/sweep arrive in PR 2). ConsultationsService fires ensureCharge
// fire-and-forget after create()/correct() -- no failure here can block or
// revert the clinical write that triggers it (spec.md
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
    private mailService: MailService,
    private notificationsService: NotificationsService,
  ) {
    // Absent => enabled by default, same criterion as
    // RemindersService/CalendarSyncService -- only an explicit "false"
    // disables charge creation.
    this.enabled = this.config.get<string>('PAYMENTS_ENABLED') !== 'false';

    // T3.10: same degradation criterion as MailService without
    // RESEND_API_KEY -- the module still registers and starts, without
    // breaking the app's boot or the tests.
    if (!this.enabled) {
      this.logger.warn(
        'PAYMENTS_ENABLED="false": el flujo de cobro en línea queda deshabilitado (no se crean cargos, no se envían emails, no se procesan callbacks).',
      );
    }
  }

  // design.md "Decision: Payment keyed on groupId, amount snapshotted at
  // creation": the single entry point called both after create() and after
  // correct() (ConsultationsService.emitPaymentCharge, same groupId in
  // both cases because groupId is invariant across the version chain). If
  // the charge already exists, the amount is never re-created nor
  // re-snapshotted -- only dueDate moves if the current sessionDate changed
  // (spec.md "Correction updates the same charge and moves its due date").
  async ensureCharge(groupId: string): Promise<void> {
    if (!this.enabled) return;

    const consultation = await this.prisma.consultation.findFirst({
      where: { groupId, correctedBy: null, deletedAt: null },
      include: {
        patient: {
          select: {
            id: true,
            defaultSessionAmount: true,
            deletedAt: true,
            email: true,
            fullName: true,
          },
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

    // spec.md "Charge Amount Resolution and Snapshot": with no resolvable
    // amount (neither a session override -- PATCH /payments/:groupId, PR 2 --
    // nor defaultSessionAmount) no charge is created. Session-override
    // precedence is implemented as a later update via updateAmount(), never
    // as a parameter of this method (same criterion as the snapshot: once
    // applied, the override is never overwritten here either).
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

    const order = await this.issueOrder(
      created.id,
      account.merchantId,
      amount,
      groupId,
    );
    await this.deliverPaymentLink(
      created.id,
      consultation.patient,
      order,
      amount,
    );
  }

  // T8.3 + design.md "Link delivery has an explicit persisted state and
  // never blocks the charge": called ONCE, right after creating the charge
  // (spec.md "Automatic Payment-Link Email Delivery" -- "at charge
  // creation", never on every subsequent ensureCharge() over a charge that
  // already exists). Without patient.email, MailService is never called at
  // all (SKIPPED_NO_EMAIL); without an `order` (missing merchantId or
  // gateway.createOrder rejecting, see issueOrder) there's also no real
  // link to send (FAILED). In both cases the charge was already created --
  // this can never prevent ensureCharge() from resolving.
  private async deliverPaymentLink(
    paymentId: string,
    patient: { email: string | null; fullName: string },
    order: { paymentUrl: string } | null,
    amount: number,
  ): Promise<void> {
    if (!patient.email) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { linkDelivery: 'SKIPPED_NO_EMAIL' },
      });
      return;
    }

    if (!order) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { linkDelivery: 'FAILED' },
      });
      return;
    }

    const sent = await this.mailService.sendPaymentLinkEmail(
      patient.email,
      patient.fullName,
      order.paymentUrl,
      amount,
    );

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        linkDelivery: sent ? 'SENT' : 'FAILED',
        linkSentAt: sent ? new Date() : null,
      },
    });
  }

  // T6.3 + design.md "Reschedule to future runs the inverse gated update
  // (LATE -> PENDING, clearing lateNotifiedAt), re-arming a genuinely new
  // late event": a LATE charge whose dueDate moves to a future date goes
  // back to PENDING and clears lateNotifiedAt, so sweep() (T6.1) can
  // transition it again (and, in PR 3, notify again) as a genuinely new
  // late event. Moving dueDate to another date still in the past does NOT
  // re-arm anything -- the charge stays LATE.
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
  // while PENDING, re-issues order + link" -- exposed here from PR 1 as
  // the service method; the controller (PR 2, task 5.5) only invokes it.
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
      const order = await this.issueOrder(
        payment.id,
        account.merchantId,
        amount,
        groupId,
      );
      const patient = await this.prisma.patient.findUnique({
        where: { id: payment.patientId },
      });
      if (patient) {
        await this.deliverPaymentLink(payment.id, patient, order, amount);
      }
    }

    return this.prisma.payment.findUniqueOrThrow({ where: { groupId } });
  }

  // spec.md "Cancellation Preserves Paid Charges and Voids Pending Ones":
  // updateMany with status: { in: CANCELLABLE_STATUSES } is itself the
  // guarantee -- a PAID charge is left out of the where, so it's never
  // touched (no explicit "if PAID, do nothing" check is ever needed).
  async cancelUnpaid(groupId: string): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { groupId, status: { in: [...CANCELLABLE_STATUSES] } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }

  // T5.7 + design.md "The confirmation callback is a signal, never a source
  // of truth": this method NEVER receives nor trusts the status carried by
  // the public POST -- payments.controller.ts (T5.6) already validated the
  // HMAC signature BEFORE calling here, but confirm() still re-queries
  // getOrderStatus with the stored token as the single source of truth. The
  // updateMany(status in CANCELLABLE_STATUSES) gate is the same idempotency
  // guarantee as cancelUnpaid: a charge already PAID or CANCELLED is left
  // out of the where (spec.md "Replayed webhook is a no-op" / "CANCELLED
  // never becomes PAID") -- returned early BEFORE calling the gateway, to
  // avoid spending a network call on a replay.
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

  // T5.4/T5.5/T7.7/T7.8: used by PaymentsController.updateAmount (PATCH
  // /payments/:groupId, scoped by @CurrentUser()) to resolve a uniform 404
  // -- therapist B requesting therapist A's groupId gets exactly the same
  // NotFoundException as a non-existent groupId, never a 403-with-leak that
  // confirms the resource exists (same criterion as
  // PatientsService.assertAccess).
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

  // design.md "Decision: One PaymentGatewayClient port": createOrder can
  // reject (PR 1 provides UnconfiguredPaymentGatewayClient by default,
  // which always rejects) without that preventing ensureCharge()/
  // updateAmount() from resolving -- the charge stays PENDING without
  // gatewayToken/paymentUrl, and the reconciler/manual retry completes it
  // later (PR 2).
  private async issueOrder(
    paymentId: string,
    merchantId: string | null,
    amount: number,
    groupId: string,
  ): Promise<{ paymentUrl: string } | null> {
    if (!merchantId) return null;

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
        // returnUrl is where Flow sends the PATIENT back after the hosted
        // checkout (frontend) -- confirmUrl is where Flow makes the
        // server-to-server POST (backend, no guard, T5.6). Never the same
        // URL: PR 1 left both pointing at the frontend as a placeholder
        // because the backend's public route didn't exist yet (see
        // PR 1's apply-progress) -- fixed here now that
        // payments.controller.ts already exists.
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
      // T8.3: the caller (ensureCharge -> deliverPaymentLink) needs the
      // just-issued paymentUrl for the email -- it's returned here instead
      // of forcing a re-fetch of the Payment already updated above.
      return { paymentUrl: order.paymentUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Fallo al crear la orden de pago (paymentId=${paymentId}, groupId=${groupId}): ${message}`,
      );
      await this.prisma.payment
        .update({ where: { id: paymentId }, data: { lastError: message } })
        .catch(() => undefined);
      return null;
    }
  }

  // T6.1-6.2 + design.md "Data Flow": same shape as
  // CalendarSyncService.reconcile -- two independent passes.
  // @nestjs/schedule's EVERY_30_MINUTES covers exactly the cadence from
  // design.md ("@Cron(EVERY_30_MINUTES) sweep()").
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    if (!this.enabled) return;

    await this.transitionLatePayments();
    await this.reconcilePendingPayments();
  }

  // T8.4 + design.md "Data Flow": unlike PR 2 (bulk updateMany, no
  // notifications), this PR needs to know WHICH rows won the transition to
  // fire the email + notification exactly once per charge -- same
  // batched-candidates-processed-one-by-one shape as
  // reconcilePendingPayments/reconcileOne. Batched to SWEEP_BATCH_LIMIT for
  // the same reason as pass 2 (row cap per cron run).
  private async transitionLatePayments(): Promise<void> {
    const candidates = await this.prisma.payment.findMany({
      where: { status: 'PENDING', dueDate: { lte: new Date() } },
      take: SWEEP_BATCH_LIMIT,
    });

    for (const payment of candidates) {
      await this.transitionOneToLate(payment).catch((err: unknown) => {
        this.logger.error(
          `Sweep: fallo al transicionar a LATE paymentId=${payment.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  // design.md "PENDING -> LATE is a stored transition, not computed" + "The
  // Payment row IS the claim -- no ReminderDispatch-style table needed":
  // the same count-gated updateMany as the rest of the module (id + status:
  // 'PENDING' in the WHERE) decides who "wins" the transition -- 1 row
  // affected fires exactly one email + one in-app notification (spec.md
  // "One-Shot Late-Payment Notification"); 0 rows (already transitioned by
  // another tick/instance, or the charge was paid/cancelled between the
  // findMany and this update) is a silent no-op, WITHOUT notifying again
  // (T10.3: "a second tick emits none"). lateNotifiedAt is persisted in the
  // same write that wins the race -- "already transitioned" and "already
  // notified" are the same atomic fact.
  private async transitionOneToLate(payment: Payment): Promise<void> {
    const result = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'LATE', lateNotifiedAt: new Date() },
    });
    if (result.count === 0) return;

    const patient = await this.prisma.patient.findUnique({
      where: { id: payment.patientId },
      select: { email: true, fullName: true },
    });
    if (!patient) return;

    if (patient.email) {
      await this.mailService.sendLatePaymentEmail(
        patient.email,
        patient.fullName,
        payment.amount,
        payment.dueDate,
      );
    }

    await this.notificationsService.create({
      userId: payment.therapistId,
      type: NotificationType.PAYMENT_LATE,
      title: 'Cobro vencido',
      body: `El cobro de la sesión con ${patient.fullName} venció sin pago.`,
      linkPath: `/consultations?patientId=${payment.patientId}`,
    });
  }

  // T6.2: reconciliation of missed callbacks -- candidates whose token was
  // issued more than RECONCILE_MIN_AGE_MS ago, batched to
  // SWEEP_BATCH_LIMIT per run (same bounded-reconcile pattern as
  // CalendarSyncService.repairFailedLinks/backfill). Each candidate is
  // processed individually because it requires one network call per row
  // (gateway.getOrderStatus) -- an isolated failure must not abort the rest
  // of the batch.
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
