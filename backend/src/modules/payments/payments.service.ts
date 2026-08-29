import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGatewayClient } from './payment-gateway.client';
import { PAYMENT_RETURN_PATH } from './payments.constants';

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';
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

  private async moveDueDateIfNeeded(
    existing: Payment,
    sessionDate: Date,
  ): Promise<void> {
    if (existing.status !== 'PENDING' && existing.status !== 'LATE') return;
    if (existing.dueDate.getTime() === sessionDate.getTime()) return;

    await this.prisma.payment.update({
      where: { id: existing.id },
      data: { dueDate: sessionDate },
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

    try {
      const order = await this.gateway.createOrder({
        merchantId,
        amount,
        currency: DEFAULT_CURRENCY,
        subject: CHARGE_SUBJECT,
        externalId: groupId,
        returnUrl: `${frontendUrl}${PAYMENT_RETURN_PATH}`,
        // Placeholder hasta que exista la ruta pública real (payments.
        // controller.ts, PR 2, task 5.6) -- el token/paymentUrl que llega
        // acá son los únicos datos que ensureCharge() persiste hoy.
        confirmUrl: `${frontendUrl}${PAYMENT_RETURN_PATH}/confirm`,
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
}
