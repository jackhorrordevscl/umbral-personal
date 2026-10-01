import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  NotificationType,
  ReminderChannel,
  ReminderOffset,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { resolveDueOffsets } from './reminders.util';
import {
  MAX_LOOKAHEAD_MS,
  REMINDER_OFFSETS,
  REMINDER_MAX_ATTEMPTS,
  REMINDER_PENDING_STALE_MS,
  REMINDER_RETRY_BACKOFF_MS,
  RETRY_BATCH_LIMIT,
  SCAN_BATCH_LIMIT,
} from './reminders.constants';

const EMAIL_NOT_CONFIRMED_ERROR =
  'El proveedor de email no confirmó el envío (sin API key o error de Resend)';

// Mismo criterio duck-typed que EmailChangeService.isUniqueConstraintError
// (email-change.service.ts) -- evita acoplar este archivo al tipo exacto de
// Prisma.PrismaClientKnownRequestError en los tests que mockean el rechazo.
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  );
}

const OFFSET_LABELS: Record<ReminderOffset, string> = REMINDER_OFFSETS.reduce(
  (labels, offset) => ({ ...labels, [offset.kind]: offset.label }),
  {} as Record<ReminderOffset, string>,
);

const CHANNELS: readonly ReminderChannel[] = [
  ReminderChannel.IN_APP,
  ReminderChannel.EMAIL,
];

interface ScannedConsultation {
  id: string;
  groupId: string;
  patientId: string;
  sessionDate: Date;
  therapistId: string;
  patient: { fullName: string };
  therapist: { name: string; email: string };
}

interface RetryCandidate {
  id: string;
  consultationId: string;
  sessionDate: Date;
  offsetKind: ReminderOffset;
  channel: ReminderChannel;
  status: 'PENDING' | 'FAILED';
  attempts: number;
  consultation: ScannedConsultation;
}

// sdd/session-reminders PR 2 (T5.2): detecta consultas próximas y despacha
// recordatorios en IN_APP + EMAIL con garantía de a-lo-más-uno por
// (groupId, sessionDate, offsetKind, channel) -- ver design.md "Technical
// Approach". El due-ness (QUÉ despachar) vive en reminders.util.ts como
// función pura; esta clase es la capa de aplicación: query, claim-then-send
// vía @@unique, y el fan-out a NotificationsService/MailService.
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);
  private readonly enabled: boolean;

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private config: ConfigService,
  ) {
    // Ausente => habilitado por default (T4.5); solo "false" explícito
    // desactiva el cron sin necesidad de un deploy/revert.
    this.enabled = this.config.get<string>('REMINDERS_ENABLED') !== 'false';
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scan(): Promise<void> {
    if (!this.enabled) return;

    const now = new Date();
    const consultations = (await this.prisma.consultation.findMany({
      where: {
        deletedAt: null,
        correctedBy: null,
        // Soft-deleted patients must not keep receiving reminders for their
        // future sessions (same guard as calendar-sync.service.ts).
        patient: { deletedAt: null },
        sessionDate: {
          gt: now,
          lte: new Date(now.getTime() + MAX_LOOKAHEAD_MS),
        },
      },
      orderBy: { sessionDate: 'asc' },
      take: SCAN_BATCH_LIMIT,
      include: {
        patient: { select: { fullName: true } },
        therapist: { select: { name: true, email: true } },
      },
    })) as ScannedConsultation[];

    for (const consultation of consultations) {
      await this.processConsultation(consultation, now);
    }

    await this.retryStaleDispatches(now);
  }

  private async processConsultation(
    consultation: ScannedConsultation,
    now: Date,
  ): Promise<void> {
    const { dispatch, skipped } = resolveDueOffsets(
      now,
      consultation.sessionDate,
    );

    for (const offsetKind of skipped) {
      for (const channel of CHANNELS) {
        await this.claimSkipped(consultation, offsetKind, channel);
      }
    }

    if (!dispatch) return;

    for (const channel of CHANNELS) {
      await this.claimAndDispatch(consultation, dispatch, channel);
    }
  }

  // "SKIPPED" ocupa la misma clave única que un envío real -- así un tick
  // posterior nunca puede despachar el offset más lejano que ya perdió
  // sentido (design.md "SKIPPED still occupies the unique key").
  private async claimSkipped(
    consultation: ScannedConsultation,
    offsetKind: ReminderOffset,
    channel: ReminderChannel,
  ): Promise<void> {
    try {
      await this.prisma.reminderDispatch.create({
        data: {
          groupId: consultation.groupId,
          sessionDate: consultation.sessionDate,
          offsetKind,
          channel,
          consultationId: consultation.id,
          therapistId: consultation.therapistId,
          status: 'SKIPPED',
        },
      });
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      // Ya reclamado por un tick anterior (SENT/FAILED/SKIPPED) -- no-op.
    }
  }

  // Claim-then-send: el INSERT con status PENDING es la operación
  // atómica que decide quién gana la carrera (design.md "Unique constraint
  // as the race-safe at-most-once guarantee"). Un P2002 acá significa que
  // otro tick/instancia ya reclamó esta tupla exacta -- se salta en
  // silencio, nunca se reintenta.
  private async claimAndDispatch(
    consultation: ScannedConsultation,
    offsetKind: ReminderOffset,
    channel: ReminderChannel,
  ): Promise<void> {
    let claim: { id: string };
    try {
      claim = (await this.prisma.reminderDispatch.create({
        data: {
          groupId: consultation.groupId,
          sessionDate: consultation.sessionDate,
          offsetKind,
          channel,
          consultationId: consultation.id,
          therapistId: consultation.therapistId,
          status: 'PENDING',
        },
      })) as { id: string };
    } catch (err) {
      if (isUniqueConstraintError(err)) return;
      throw err;
    }

    await this.sendAndMark(claim.id, consultation, offsetKind, channel);
  }

  // issue #286: reintentos acotados. Recoge dispatches FAILED, o PENDING
  // abandonados (claimedAt viejo: el proceso murió entre el claim y el
  // envío), con attempts < REMINDER_MAX_ATTEMPTS y cuya sesión sigue vigente
  // y futura. Cada fila se re-reclama con un updateMany condicional
  // (status + attempts leídos) para que dos instancias no la reintenten a la
  // vez. Garantía: at-least-once -- en el caso raro de un PENDING abandonado
  // cuyo envío sí salió antes de morir el proceso, el reintento puede
  // duplicar el aviso; es preferible a perderlo en silencio.
  private async retryStaleDispatches(now: Date): Promise<void> {
    const staleCutoff = new Date(now.getTime() - REMINDER_PENDING_STALE_MS);
    const backoffCutoff = new Date(now.getTime() - REMINDER_RETRY_BACKOFF_MS);
    const rows = (await this.prisma.reminderDispatch.findMany({
      where: {
        attempts: { lt: REMINDER_MAX_ATTEMPTS },
        OR: [
          { status: 'FAILED', claimedAt: { lt: backoffCutoff } },
          { status: 'PENDING', claimedAt: { lt: staleCutoff } },
        ],
        consultation: {
          deletedAt: null,
          correctedBy: null,
          patient: { deletedAt: null },
          sessionDate: { gt: now },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: RETRY_BATCH_LIMIT,
      include: {
        consultation: {
          include: {
            patient: { select: { fullName: true } },
            therapist: { select: { name: true, email: true } },
          },
        },
      },
    })) as RetryCandidate[];

    for (const row of rows) {
      // Si la sesión se reprogramó, esta fila corresponde a la fecha vieja:
      // los offsets de la nueva fecha los reclama el scan normal.
      if (
        row.sessionDate.getTime() !== row.consultation.sessionDate.getTime()
      ) {
        continue;
      }

      const reclaimed = await this.prisma.reminderDispatch.updateMany({
        where: { id: row.id, status: row.status, attempts: row.attempts },
        data: {
          status: 'PENDING',
          attempts: { increment: 1 },
          error: null,
          claimedAt: new Date(),
        },
      });
      if (reclaimed.count !== 1) continue;

      if (row.attempts + 1 >= REMINDER_MAX_ATTEMPTS) {
        this.logger.warn(
          `Último intento de recordatorio ${row.channel}/${row.offsetKind} para consultationId=${row.consultationId}`,
        );
      }
      await this.sendAndMark(
        row.id,
        row.consultation,
        row.offsetKind,
        row.channel,
      );
    }
  }

  // Envía por el canal y deja el dispatch en SENT o FAILED. Compartido por el
  // primer despacho y por los reintentos.
  private async sendAndMark(
    claimId: string,
    consultation: ScannedConsultation,
    offsetKind: ReminderOffset,
    channel: ReminderChannel,
  ): Promise<void> {
    const offsetLabel = OFFSET_LABELS[offsetKind];

    try {
      // issue #163: resendMessageId queda null para IN_APP (no aplica).
      let resendMessageId: string | null = null;
      if (channel === ReminderChannel.IN_APP) {
        await this.notificationsService.create({
          userId: consultation.therapistId,
          type: NotificationType.SESSION_REMINDER,
          title: `Recordatorio de sesión en ${offsetLabel}`,
          body: `Tu sesión con ${consultation.patient.fullName} está programada para ${consultation.sessionDate.toISOString()} (en ${offsetLabel}).`,
          // La ruta real (App.tsx) es /consultations sin :id -- el detalle
          // vive en query params que ConsultationsPage lee para
          // preseleccionar el paciente y abrir el modal de Corregir sesión.
          linkPath: `/consultations?patientId=${consultation.patientId}&consultationId=${consultation.id}`,
        });
      } else {
        // MailService.sendSessionReminderEmail nunca lanza por contrato
        // (ver mail.service.ts), pero igual queda dentro de este try/catch:
        // ambos canales deben permanecer independientes sin importar qué
        // garantice la implementación concreta de cada uno.
        resendMessageId = await this.mailService.sendSessionReminderEmail(
          consultation.therapist.email,
          consultation.therapist.name,
          consultation.patient.fullName,
          consultation.sessionDate,
          offsetLabel,
        );
        // issue #286: null significa que el proveedor no confirmó el envío
        // (sin RESEND_API_KEY o error de Resend). No es SENT: queda FAILED
        // y el reintento acotado lo recoge.
        if (resendMessageId === null) {
          throw new Error(EMAIL_NOT_CONFIRMED_ERROR);
        }
      }
      await this.prisma.reminderDispatch.update({
        where: { id: claimId },
        data: { status: 'SENT', sentAt: new Date(), resendMessageId },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Falló el despacho de recordatorio ${channel}/${offsetKind} para consultationId=${consultation.id}: ${message}`,
      );
      await this.prisma.reminderDispatch
        .update({
          where: { id: claimId },
          data: { status: 'FAILED', error: message },
        })
        .catch(() => undefined);
    }
  }
}
