import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType, Payment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GatewayContext } from './payment-gateway.client';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { PaymentAccountService } from './payment-account.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PAYMENT_CONFIRM_PATH,
  PAYMENT_RETURN_PATH,
  PAYMENT_RETURN_REDIRECT_PATH,
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

interface IssueOrderRequest {
  paymentId: string;
  context: GatewayContext;
  amount: number;
  groupId: string;
  payerEmail: string;
}

// design.md "Technical Approach": PaymentsService is the sole owner of the
// charge lifecycle. It never touches PaymentAccount rows or ciphertext
// directly (sdd/payments-multigateway-redesign, design.md "Component
// Responsibilities") -- every credential is resolved through
// PaymentAccountService.resolveGatewayContext(), which returns null for any
// account that isn't CONNECTED with a v2 credential blob, reusing the
// existing "no order, charge stays PENDING" degradation path unchanged
// (spec "Automatic Charge Creation Gated by Gateway Connection").
// ConsultationsService fires ensureCharge fire-and-forget after
// create()/correct() -- no failure here can block or revert the clinical
// write that triggers it (spec.md "Feature Flag Gating", design.md "Nothing
// in this module can fail a clinical write").
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly enabled: boolean;

  constructor(
    private prisma: PrismaService,
    private paymentAccountService: PaymentAccountService,
    private gatewayRegistry: PaymentGatewayRegistry,
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
  //
  // sdd/payments-multigateway-redesign (spec "Automatic Charge Creation
  // Gated by Gateway Connection"): the gating check now asks
  // resolveGatewayContext() for a context instead of reading
  // PaymentAccount.status directly -- null covers every non-CONNECTED
  // status (PENDING/DISCONNECTED/RECONNECT_REQUIRED) uniformly, including
  // an account whose credentialVersion isn't 2 yet (still-CONNECTED legacy
  // row mid-migration, PaymentAccountService's own guard).
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
        therapist: { select: { email: true } },
      },
    });
    if (!consultation || consultation.patient.deletedAt) return;

    const context = await this.paymentAccountService.resolveGatewayContext(
      consultation.therapistId,
    );
    if (!context) return;

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

    const order = await this.issueOrder({
      paymentId: created.id,
      context,
      amount,
      groupId,
      payerEmail: consultation.patient.email ?? consultation.therapist.email,
    });
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
  // all (SKIPPED_NO_EMAIL); without an `order` (no gateway context or
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
  // the service method; the controller only invokes it. Same gating as
  // ensureCharge: no gateway context (account not CONNECTED with a v2
  // blob) means the amount override still lands, but no new order/link is
  // issued.
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

    const context = await this.paymentAccountService.resolveGatewayContext(
      payment.therapistId,
    );
    if (context) {
      const patient = await this.prisma.patient.findUnique({
        where: { id: payment.patientId },
      });
      const payerEmail = await this.resolvePayerEmail(
        patient?.email ?? null,
        payment.therapistId,
      );
      const order = await this.issueOrder({
        paymentId: payment.id,
        context,
        amount,
        groupId,
        payerEmail,
      });
      if (patient) {
        await this.deliverPaymentLink(payment.id, patient, order, amount);
      }
    }

    return this.prisma.payment.findUniqueOrThrow({ where: { groupId } });
  }

  // Manual resend of an already-issued link (button next to "Copiar link de
  // pago", ConsultationsPage) -- reuses the existing paymentUrl instead of
  // re-issuing an order with the gateway, since the charge itself hasn't
  // changed. Same linkDelivery/linkSentAt bookkeeping as deliverPaymentLink,
  // but callable any number of times (not gated to "once at charge
  // creation").
  async resendPaymentLink(groupId: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { groupId },
    });
    if (!payment.paymentUrl) {
      throw new BadRequestException(
        'No hay un link de pago disponible para reenviar.',
      );
    }

    const patient = await this.prisma.patient.findUnique({
      where: { id: payment.patientId },
    });
    if (!patient?.email) {
      throw new BadRequestException(
        'El paciente no tiene un email registrado.',
      );
    }

    const sent = await this.mailService.sendPaymentLinkEmail(
      patient.email,
      patient.fullName,
      payment.paymentUrl,
      payment.amount,
    );

    return this.prisma.payment.update({
      where: { groupId },
      data: {
        linkDelivery: sent ? 'SENT' : 'FAILED',
        linkSentAt: sent ? new Date() : null,
      },
    });
  }

  // Flow's /payment/create requires an email param (discovered against a
  // real sandbox, see flow-gateway.client.ts header) unrelated to link
  // delivery -- falls back to the therapist's own email only when the
  // patient has none, purely to satisfy that requirement. Queries User only
  // when the fallback is actually needed.
  private async resolvePayerEmail(
    patientEmail: string | null,
    therapistId: string,
  ): Promise<string> {
    if (patientEmail) return patientEmail;
    const therapist = await this.prisma.user.findUniqueOrThrow({
      where: { id: therapistId },
      select: { email: true },
    });
    return therapist.email;
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

  // sdd/payments-multigateway-redesign (design.md "Webhook — after"):
  // read-only lookup used by PaymentsController.confirm BEFORE any
  // decryption or signature verification -- an unknown token fails with a
  // 400 here, without this method (or resolveGatewayContext) ever running.
  // Never mutates.
  async findByToken(token: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({ where: { gatewayToken: token } });
  }

  // T5.7 + design.md "The confirmation callback is a signal, never a source
  // of truth": this method NEVER receives nor trusts the status carried by
  // the public POST -- payments.controller.ts already validated the
  // signature (resolving the owning therapist's own credentials, then
  // calling registry.get(provider).verifyCallbackSignature) BEFORE calling
  // here, but confirm() still re-queries getOrderStatus with the stored
  // token as the single source of truth, resolving the gateway context
  // itself rather than trusting a value passed in. The
  // updateMany(status in CANCELLABLE_STATUSES) gate is the same idempotency
  // guarantee as cancelUnpaid: a charge already PAID or CANCELLED is left
  // out of the where (spec.md "Replayed webhook is a no-op" / "CANCELLED
  // never becomes PAID") -- returned early BEFORE calling the gateway, to
  // avoid spending a network call on a replay. If the owning account lost
  // its connection between order-issuance and this re-query (context is
  // null), the charge is left exactly as it was -- there is no credential
  // left to ask Flow with, and the controller already rejected an
  // unverifiable signature before ever reaching this point in that case.
  async confirm(token: string): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { gatewayToken: token },
    });
    if (!payment) return;
    if (!(CANCELLABLE_STATUSES as readonly string[]).includes(payment.status)) {
      return;
    }

    const context = await this.paymentAccountService.resolveGatewayContext(
      payment.therapistId,
    );
    if (!context) return;

    const orderStatus = await this.gatewayRegistry
      .get(context.provider)
      .getOrderStatus(context.credentials, token);
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

  // Used by PaymentsController.returnFromGateway (bug fix: returnUrl used to
  // point straight at the frontend's PAYMENT_RETURN_PATH, but Flow's redirect
  // back is a browser-submitted POST that a static SPA route can't handle,
  // and that route also sat behind the therapist's auth layout). This never
  // reads or mutates Payment state -- it only resolves WHERE to bounce the
  // patient's browser, so an unrecognized/tampered token is harmless: the
  // worst case is a patient landing on the thank-you page with a token that
  // doesn't resolve to anything, same as landing there with none at all.
  resolveReturnRedirectUrl(token?: string): string {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? DEFAULT_FRONTEND_URL;
    const url = `${frontendUrl}${PAYMENT_RETURN_PATH}`;
    return token ? `${url}?token=${encodeURIComponent(token)}` : url;
  }

  // design.md "Charge a session — after": issueOrder(ctx) -- takes the
  // already-resolved GatewayContext instead of a merchantId, and routes the
  // call through the registry so a second provider needs no change here
  // (proposal.md "Extensible gateway selection"). Can reject without that
  // preventing ensureCharge()/updateAmount() from resolving -- the charge
  // stays PENDING without gatewayToken/paymentUrl, and the
  // reconciler/manual retry completes it later.
  private async issueOrder(
    request: IssueOrderRequest,
  ): Promise<{ paymentUrl: string } | null> {
    const { paymentId, context, amount, groupId, payerEmail } = request;
    const backendUrl =
      this.config.get<string>('BACKEND_PUBLIC_URL') ?? DEFAULT_BACKEND_URL;

    try {
      const order = await this.gatewayRegistry
        .get(context.provider)
        .createOrder(context.credentials, {
          amount,
          currency: DEFAULT_CURRENCY,
          subject: CHARGE_SUBJECT,
          externalId: groupId,
          payerEmail,
          // Both returnUrl and confirmUrl point at the BACKEND -- confirmUrl
          // because it's always been a server-to-server POST (T5.6), and
          // returnUrl because Flow's redirect back is ALSO a browser-
          // submitted POST (confirmed against a real sandbox run), which a
          // static frontend SPA route has no server-side handler for.
          // PaymentsController.returnFromGateway (no guard, same tier as
          // confirm) receives it and 302-redirects the patient's browser to
          // the real frontend page (PAYMENT_RETURN_PATH) as a GET.
          returnUrl: `${backendUrl}${PAYMENT_RETURN_REDIRECT_PATH}`,
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
  // design.md ("@Cron(EVERY_30_MINUTES) sweep()"). design.md Decision 2:
  // the gateway context each candidate needs is resolved per payment and
  // memoized in a Map local to this one run (keyed by therapistId), so two
  // pending charges owned by the same therapist in the same sweep tick only
  // decrypt once -- the map is discarded when sweep() returns, no
  // long-lived plaintext cache.
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    if (!this.enabled) return;

    const contextCache = new Map<string, GatewayContext | null>();
    await this.transitionLatePayments();
    await this.reconcilePendingPayments(contextCache);
  }

  // T8.4 + design.md "Data Flow": unlike PR 2 (bulk updateMany, no
  // notifications), this PR needs to know WHICH rows won the transition to
  // fire the email + notification exactly once per charge -- same
  // batched-candidates-processed-one-by-one shape as
  // reconcilePendingPayments/reconcileOne. Batched to SWEEP_BATCH_LIMIT for
  // the same reason as pass 2 (row cap per cron run). This pass never calls
  // the gateway, so it needs no gateway context at all.
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
  private async reconcilePendingPayments(
    contextCache: Map<string, GatewayContext | null>,
  ): Promise<void> {
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
      await this.reconcileOne(payment, contextCache).catch((err: unknown) => {
        this.logger.error(
          `Sweep: fallo al reconciliar paymentId=${payment.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  // design.md Decision 2: resolves through the run-scoped memo cache
  // instead of calling PaymentAccountService.resolveGatewayContext (which
  // decrypts) on every candidate -- an account with several stale charges
  // in the same sweep tick is decrypted at most once.
  private async resolveContextMemoized(
    therapistId: string,
    cache: Map<string, GatewayContext | null>,
  ): Promise<GatewayContext | null> {
    if (cache.has(therapistId)) {
      return cache.get(therapistId) ?? null;
    }
    const context =
      await this.paymentAccountService.resolveGatewayContext(therapistId);
    cache.set(therapistId, context);
    return context;
  }

  private async reconcileOne(
    payment: Payment,
    contextCache: Map<string, GatewayContext | null>,
  ): Promise<void> {
    if (!payment.gatewayToken) return;

    const context = await this.resolveContextMemoized(
      payment.therapistId,
      contextCache,
    );
    if (!context) return;

    const orderStatus = await this.gatewayRegistry
      .get(context.provider)
      .getOrderStatus(context.credentials, payment.gatewayToken);
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
