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
  SCAN_BATCH_LIMIT,
} from './reminders.constants';

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
  sessionDate: Date;
  therapistId: string;
  patient: { fullName: string };
  therapist: { name: string; email: string };
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

    const offsetLabel = OFFSET_LABELS[offsetKind];

    try {
      if (channel === ReminderChannel.IN_APP) {
        await this.notificationsService.create({
          userId: consultation.therapistId,
          type: NotificationType.SESSION_REMINDER,
          title: `Recordatorio de sesión en ${offsetLabel}`,
          body: `Tu sesión con ${consultation.patient.fullName} está programada para ${consultation.sessionDate.toISOString()} (en ${offsetLabel}).`,
          linkPath: `/consultations/${consultation.id}`,
        });
      } else {
        // MailService.sendSessionReminderEmail nunca lanza por contrato
        // (ver mail.service.ts), pero igual queda dentro de este try/catch:
        // ambos canales deben permanecer independientes sin importar qué
        // garantice la implementación concreta de cada uno.
        await this.mailService.sendSessionReminderEmail(
          consultation.therapist.email,
          consultation.therapist.name,
          consultation.patient.fullName,
          consultation.sessionDate,
          offsetLabel,
        );
      }
      await this.prisma.reminderDispatch.update({
        where: { id: claim.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Falló el despacho de recordatorio ${channel}/${offsetKind} para consultationId=${consultation.id}: ${message}`,
      );
      await this.prisma.reminderDispatch
        .update({
          where: { id: claim.id },
          data: { status: 'FAILED', error: message },
        })
        .catch(() => undefined);
    }
  }
}
