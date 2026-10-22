import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  NotificationType,
  Prisma,
  ReminderChannel,
  ReminderOffset,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import {
  buildActionableConsultationWhere,
  resolveDueOffsets,
} from './reminders.util';
import {
  MAX_LOOKAHEAD_MS,
  REMINDER_CHANNELS,
  REMINDER_OFFSETS,
  REMINDER_MAX_ATTEMPTS,
  REMINDER_PENDING_STALE_MS,
  REMINDER_RETRY_BACKOFF_MS,
  RENDER_TIME_ZONE,
  RETRY_BATCH_LIMIT,
  SCAN_BATCH_LIMIT,
  SCAN_MAX_PAGES,
} from './reminders.constants';

// Zona fija de render (America/Santiago): el servidor puede correr en UTC y
// el terapeuta debe ver la hora local de la sesión.
const sessionDateFormatter = new Intl.DateTimeFormat('es-CL', {
  timeZone: RENDER_TIME_ZONE,
  dateStyle: 'full',
  timeStyle: 'short',
});
const formatSessionDate = (date: Date): string =>
  sessionDateFormatter.format(date);

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

const CHANNELS: readonly ReminderChannel[] = REMINDER_CHANNELS;

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
  consultation: ScannedConsultation & { correctedBy?: { id: string } | null };
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
    const where: Prisma.ConsultationWhereInput = {
      deletedAt: null,
      correctedBy: null,
      // Soft-deleted patients must not keep receiving reminders for their
      // future sessions (same guard as calendar-sync.service.ts).
      patient: { deletedAt: null },
      sessionDate: {
        gt: now,
        lte: new Date(now.getTime() + MAX_LOOKAHEAD_MS),
      },
      // issue #286: solo consultas a las que aún les falta algún dispatch en
      // el offset vigente; las ya reclamadas no ocupan lugar en el lote.
      ...buildActionableConsultationWhere(now),
    };

    // issue #286: paginación keyset por (sessionDate, id) hasta agotar la
    // ventana. Las filas reclamadas durante el tick salen del filtro, así que
    // un cursor por id + skip saltaría la primera fila que queda; la
    // condición "estrictamente posterior a la última vista" no depende de que
    // esa fila siga existiendo en el resultado.
    let lastSeen: { sessionDate: Date; id: string } | undefined;
    for (let page = 0; page < SCAN_MAX_PAGES; page++) {
      const consultations = (await this.prisma.consultation.findMany({
        where: lastSeen
          ? {
              AND: [
                where,
                {
                  OR: [
                    { sessionDate: { gt: lastSeen.sessionDate } },
                    {
                      sessionDate: lastSeen.sessionDate,
                      id: { gt: lastSeen.id },
                    },
                  ],
                },
              ],
            }
          : where,
        orderBy: [{ sessionDate: 'asc' }, { id: 'asc' }],
        take: SCAN_BATCH_LIMIT,
        include: {
          patient: { select: { fullName: true } },
          therapist: { select: { name: true, email: true } },
        },
      })) as ScannedConsultation[];

      for (const consultation of consultations) {
        // Un error de una consulta (p. ej. la DB cortó una conexión) no debe
        // abortar el resto del lote ni los reintentos: el próximo tick la
        // vuelve a tomar porque su claim no quedó registrado.
        try {
          await this.processConsultation(consultation, now);
        } catch (err) {
          this.logger.error(
            `Falló el procesamiento de recordatorios para consultationId=${consultation.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (consultations.length < SCAN_BATCH_LIMIT) break;
      lastSeen = consultations[consultations.length - 1];
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
      // Ya reclamado por un tick anterior (SENT/FAILED/SKIPPED).
      await this.adoptExistingClaim(consultation, offsetKind, channel);
    }
  }

  // El unique es por groupId, pero el filtro "accionable" mira los dispatches
  // por consultationId. Si el terapeuta corrigió la consulta, la versión nueva
  // choca con el claim de la anterior y, sin esto, seguiría pareciendo
  // accionable en cada tick. Re-apuntar el claim a la versión vigente la saca
  // del filtro; si ya apuntaba a ella (otro tick), no toca nada.
  private async adoptExistingClaim(
    consultation: ScannedConsultation,
    offsetKind: ReminderOffset,
    channel: ReminderChannel,
  ): Promise<void> {
    await this.prisma.reminderDispatch.updateMany({
      where: {
        groupId: consultation.groupId,
        sessionDate: consultation.sessionDate,
        offsetKind,
        channel,
        consultationId: { not: consultation.id },
      },
      data: { consultationId: consultation.id },
    });
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
      if (!isUniqueConstraintError(err)) throw err;
      await this.adoptExistingClaim(consultation, offsetKind, channel);
      return;
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
        // Sin `correctedBy: null`: si el terapeuta corrigió la consulta, la
        // nueva versión no puede reclamar este offset (el unique es por
        // groupId), así que el reintento lo envía con la versión vigente.
        consultation: {
          deletedAt: null,
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
            correctedBy: { select: { id: true } },
          },
        },
      },
    })) as RetryCandidate[];

    for (const row of rows) {
      try {
        await this.retryDispatch(row, now);
      } catch (err) {
        this.logger.error(
          `Falló el reintento del dispatch ${row.id} (consultationId=${row.consultationId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async retryDispatch(row: RetryCandidate, now: Date): Promise<void> {
    const consultation = await this.resolveCurrentVersion(row, now);
    if (!consultation) return;

    // Si la sesión se reprogramó, esta fila corresponde a la fecha vieja:
    // los offsets de la nueva fecha los reclama el scan normal.
    if (row.sessionDate.getTime() !== consultation.sessionDate.getTime()) {
      return;
    }

    const reclaimed = await this.prisma.reminderDispatch.updateMany({
      where: { id: row.id, status: row.status, attempts: row.attempts },
      data: {
        status: 'PENDING',
        attempts: { increment: 1 },
        error: null,
        claimedAt: new Date(),
        consultationId: consultation.id,
      },
    });
    if (reclaimed.count !== 1) return;

    if (row.attempts + 1 >= REMINDER_MAX_ATTEMPTS) {
      this.logger.warn(
        `Último intento de recordatorio ${row.channel}/${row.offsetKind} para consultationId=${consultation.id}`,
      );
    }
    await this.sendAndMark(row.id, consultation, row.offsetKind, row.channel);
  }

  // La consulta del dispatch puede haber sido corregida: las versiones
  // comparten groupId y solo la última (correctedBy null) sigue vigente.
  // Devuelve null si ya no hay versión vigente que avisar.
  private async resolveCurrentVersion(
    row: RetryCandidate,
    now: Date,
  ): Promise<ScannedConsultation | null> {
    if (!row.consultation.correctedBy) return row.consultation;

    return (await this.prisma.consultation.findFirst({
      where: {
        groupId: row.consultation.groupId,
        correctedBy: null,
        deletedAt: null,
        patient: { deletedAt: null },
        sessionDate: { gt: now },
      },
      include: {
        patient: { select: { fullName: true } },
        therapist: { select: { name: true, email: true } },
      },
    })) as ScannedConsultation | null;
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
          body: `Tu sesión con ${consultation.patient.fullName} está programada para ${formatSessionDate(consultation.sessionDate)} (en ${offsetLabel}).`,
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
