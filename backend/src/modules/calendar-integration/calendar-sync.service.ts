import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  NotificationType,
  type GoogleCalendarConnection,
} from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleTokenCryptoService } from './google-token-crypto.service';
import {
  GoogleCalendarClient,
  GoogleCalendarError,
  type GoogleCalendarEventBody,
} from './google-calendar.client';
import { NotificationsService } from '../notifications/notifications.service';
import { patientLabel } from './patient-code.util';
import {
  BACKFILL_WINDOW_DAYS,
  CALENDAR_TIME_ZONE,
  DEFAULT_SESSION_MINUTES,
  RECONCILE_BATCH_LIMIT,
} from './calendar-integration.constants';

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Formas mínimas que este servicio necesita de cada consulta -- nunca el
// tipo Consultation completo, para que quede explícito en la firma qué
// campos clínicos NUNCA llegan a tocar el builder del evento (T6.3).
interface PatientRef {
  id: string;
  fullName: string;
}

interface SyncableConsultation {
  id: string;
  groupId: string;
  therapistId: string;
  sessionDate: Date;
  patient: PatientRef;
}

// design.md "Technical Approach": CalendarSyncService es el único dueño de
// la propagación push-only hacia Google Calendar. `create()`/`correct()`
// (ConsultationsService) llaman syncGroup() fire-and-forget al confirmar su
// transacción; el reconciler (@Cron) es la red de seguridad que repara todo
// lo que un intent perdido haya dejado divergente -- ninguna de las dos vías
// puede jamás fallar ni retrasar la escritura clínica que la originó
// (spec.md "Non-Blocking Sync Failures").
@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);
  private readonly enabled: boolean;

  constructor(
    private prisma: PrismaService,
    private tokenCrypto: GoogleTokenCryptoService,
    private googleCalendarClient: GoogleCalendarClient,
    private notificationsService: NotificationsService,
    private config: ConfigService,
  ) {
    // Ausente => habilitado por default (mismo criterio que
    // RemindersService.enabled) -- solo "false" explícito apaga tanto el
    // cron como los intents del write-path (gotcha del proyecto:
    // GOOGLE_CALENDAR_SYNC_ENABLED debe respetarse en ambos lugares).
    this.enabled =
      this.config.get<string>('GOOGLE_CALENDAR_SYNC_ENABLED') !== 'false';
  }

  // design.md "Event link keyed on (connectionId, groupId)": groupId es
  // invariante a través de toda la cadena de versiones de una consulta, así
  // que correct() (que crea una fila NUEVA, nunca toca la original) siempre
  // resuelve al mismo link y termina en un patch, nunca en un insert
  // duplicado (T6.9/T6.10).
  async syncGroup(groupId: string): Promise<void> {
    if (!this.enabled) return;

    const consultation = await this.prisma.consultation.findFirst({
      where: { groupId, correctedBy: null, deletedAt: null },
      include: {
        patient: { select: { id: true, fullName: true, deletedAt: true } },
      },
    });
    if (!consultation || consultation.patient.deletedAt) return;

    const connection = await this.prisma.googleCalendarConnection.findUnique({
      where: { therapistId: consultation.therapistId },
    });
    if (!connection || connection.status !== 'CONNECTED') return;

    await this.pushConsultation(connection, consultation);
  }

  // design.md "Fire-and-forget intents plus a bounded reconciler": repara,
  // en este orden, (1) links que quedaron FAILED de un intento anterior,
  // (2) consultas/pacientes borrados cuyo evento sigue vivo en Google, (3)
  // drift de sessionDate que un intent perdido dejó sin propagar, y (4) un
  // backfill acotado de sesiones futuras sin link. El orden importa: borrar
  // antes de reparar drift evita parchear un evento que este mismo tick va
  // a eliminar.
  // @nestjs/schedule's CronExpression enum no incluye un valor de 15
  // minutos (solo 5/10/30) -- expresión cron cruda equivalente.
  @Cron('*/15 * * * *')
  async reconcile(): Promise<void> {
    if (!this.enabled) return;

    const connections = await this.prisma.googleCalendarConnection.findMany({
      where: { status: 'CONNECTED' },
    });

    for (const connection of connections) {
      await this.reconcileConnection(connection);
    }
  }

  // design.md "On reconnect with a different googleAccountEmail, purge all
  // CalendarEventLink rows": los links viejos apuntan a eventos de una
  // cuenta de Google que ya no es la conectada -- reutilizarlos rompería el
  // mapeo. NOTA (deviation, ver apply-progress/PR1): con el scope
  // `calendar.events` únicamente (sin `email`/`openid`), Umbral no tiene hoy
  // ninguna vía para resolver el googleAccountEmail real -- este método
  // queda implementado y probado, pero ningún llamador real le pasa todavía
  // un `newEmail` no nulo (ver CalendarOauthService.exchangeCodeAndPersist).
  async purgeLinksOnAccountChange(
    connectionId: string,
    previousEmail: string | null,
    newEmail: string | null | undefined,
  ): Promise<void> {
    if (!previousEmail || !newEmail || previousEmail === newEmail) return;

    await this.prisma.calendarEventLink.deleteMany({
      where: { connectionId },
    });
  }

  // T5.7: único disparador real de borrado hoy (design.md "Confirmed
  // Decisions" -- ningún endpoint escribe Consultation.deletedAt todavía).
  // Fire-and-forget desde PatientsService.softDelete, igual que
  // create()/correct() (spec.md "Non-Blocking Sync Failures").
  async deletePatientEvents(patientId: string): Promise<void> {
    if (!this.enabled) return;

    const consultations = await this.prisma.consultation.findMany({
      where: {
        patientId,
        correctedBy: null,
        sessionDate: { gt: new Date() },
      },
      select: { groupId: true, therapistId: true },
    });
    if (consultations.length === 0) return;

    const therapistIds = [...new Set(consultations.map((c) => c.therapistId))];
    const connections = await this.prisma.googleCalendarConnection.findMany({
      where: { therapistId: { in: therapistIds }, status: 'CONNECTED' },
    });
    const connectionByTherapist = new Map(
      connections.map((c) => [c.therapistId, c]),
    );

    for (const consultation of consultations) {
      const connection = connectionByTherapist.get(consultation.therapistId);
      if (!connection) continue;

      await this.deleteLinkForGroup(connection, consultation.groupId).catch(
        (err: unknown) => {
          this.logger.error(
            `Fallo al eliminar el evento de Google para groupId=${consultation.groupId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      );
    }
  }

  private async reconcileConnection(
    connection: GoogleCalendarConnection,
  ): Promise<void> {
    await this.repairFailedLinks(connection);
    await this.deleteForRemovedConsultations(connection);
    await this.repairDriftedLinks(connection);
    await this.backfill(connection);
  }

  private async repairFailedLinks(
    connection: GoogleCalendarConnection,
  ): Promise<void> {
    const links = await this.prisma.calendarEventLink.findMany({
      where: { connectionId: connection.id, syncStatus: 'FAILED' },
      take: RECONCILE_BATCH_LIMIT,
    });

    for (const link of links) {
      await this.syncGroup(link.groupId).catch((err: unknown) => {
        this.logger.error(
          `Reconcile: fallo al reparar link FAILED groupId=${link.groupId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  // T6.7/T6.8: la ventana de 90 días SOLO gobierna el backfill (qué se
  // empieza a sincronizar); nunca la eliminación. Un evento ya vinculado que
  // se mueve fuera de la ventana sigue viviendo en Google y se sigue
  // parcheando -- solo consultation.deletedAt/patient.deletedAt disparan un
  // delete real.
  private async deleteForRemovedConsultations(
    connection: GoogleCalendarConnection,
  ): Promise<void> {
    const links = await this.prisma.calendarEventLink.findMany({
      where: { connectionId: connection.id },
      take: RECONCILE_BATCH_LIMIT,
    });
    if (links.length === 0) return;

    const groupIds = links.map((l) => l.groupId);
    const consultations = await this.prisma.consultation.findMany({
      where: { groupId: { in: groupIds }, correctedBy: null },
      select: {
        groupId: true,
        deletedAt: true,
        patient: { select: { deletedAt: true } },
      },
    });
    const byGroupId = new Map(consultations.map((c) => [c.groupId, c]));

    for (const link of links) {
      const consultation = byGroupId.get(link.groupId);
      const shouldDelete =
        !consultation ||
        consultation.deletedAt !== null ||
        consultation.patient.deletedAt !== null;

      if (!shouldDelete) continue;

      await this.deleteLinkForGroup(connection, link.groupId).catch(
        (err: unknown) => {
          this.logger.error(
            `Reconcile: fallo al eliminar evento removido groupId=${link.groupId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      );
    }
  }

  private async repairDriftedLinks(
    connection: GoogleCalendarConnection,
  ): Promise<void> {
    const links = await this.prisma.calendarEventLink.findMany({
      where: { connectionId: connection.id, syncStatus: 'SYNCED' },
      take: RECONCILE_BATCH_LIMIT,
    });
    if (links.length === 0) return;

    const groupIds = links.map((l) => l.groupId);
    const consultations = await this.prisma.consultation.findMany({
      where: { groupId: { in: groupIds }, correctedBy: null, deletedAt: null },
      select: { groupId: true, sessionDate: true },
    });
    const byGroupId = new Map(consultations.map((c) => [c.groupId, c]));

    for (const link of links) {
      const consultation = byGroupId.get(link.groupId);
      if (!consultation) continue; // ya cubierto por deleteForRemovedConsultations

      if (
        consultation.sessionDate.getTime() !== link.lastSessionDate.getTime()
      ) {
        await this.syncGroup(link.groupId).catch((err: unknown) => {
          this.logger.error(
            `Reconcile: fallo al reparar drift groupId=${link.groupId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    }
  }

  // design.md "Bounded Backfill at Connect Time": en la práctica también es
  // la red de seguridad de cada tick del reconciler, no solo del momento de
  // conectar -- cualquier sesión futura dentro de la ventana que todavía no
  // tenga link (porque el intent se perdió, o porque se conectó recién) se
  // sincroniza acá.
  private async backfill(connection: GoogleCalendarConnection): Promise<void> {
    const now = new Date();
    const windowEnd = new Date(
      now.getTime() + BACKFILL_WINDOW_DAYS * MS_PER_DAY,
    );

    const candidates = await this.prisma.consultation.findMany({
      where: {
        therapistId: connection.therapistId,
        correctedBy: null,
        deletedAt: null,
        patient: { deletedAt: null },
        sessionDate: { gt: now, lte: windowEnd },
      },
      select: { groupId: true },
      take: RECONCILE_BATCH_LIMIT,
    });
    if (candidates.length === 0) return;

    const groupIds = candidates.map((c) => c.groupId);
    const linkedGroupIds = new Set(
      (
        await this.prisma.calendarEventLink.findMany({
          where: { connectionId: connection.id, groupId: { in: groupIds } },
          select: { groupId: true },
        })
      ).map((l) => l.groupId),
    );

    for (const candidate of candidates) {
      if (linkedGroupIds.has(candidate.groupId)) continue;

      await this.syncGroup(candidate.groupId).catch((err: unknown) => {
        this.logger.error(
          `Reconcile: fallo en backfill groupId=${candidate.groupId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  // T5.1/T5.3: decide insert vs. patch según exista un link, y clasifica
  // cualquier error de Google en las tres acciones de design.md "Failure
  // classification" -- ninguna de las tres se propaga jamás al llamador
  // (fire-and-forget en los call sites, spec.md "Non-Blocking Sync
  // Failures").
  private async pushConsultation(
    connection: GoogleCalendarConnection,
    consultation: SyncableConsultation,
  ): Promise<void> {
    const oauth2Client = this.buildOAuth2Client(connection);
    const eventBody = this.buildEventBody(consultation);

    const existingLink = await this.prisma.calendarEventLink.findUnique({
      where: {
        connectionId_groupId: {
          connectionId: connection.id,
          groupId: consultation.groupId,
        },
      },
    });

    try {
      if (existingLink) {
        await this.googleCalendarClient.patchEvent(
          oauth2Client,
          connection.calendarId,
          existingLink.googleEventId,
          eventBody,
        );
        await this.prisma.calendarEventLink.update({
          where: { id: existingLink.id },
          data: {
            lastSessionDate: consultation.sessionDate,
            syncStatus: 'SYNCED',
            lastError: null,
          },
        });
        return;
      }

      const created = await this.googleCalendarClient.insertEvent(
        oauth2Client,
        connection.calendarId,
        eventBody,
      );
      await this.prisma.calendarEventLink.create({
        data: {
          connectionId: connection.id,
          groupId: consultation.groupId,
          googleEventId: created.id,
          lastSessionDate: consultation.sessionDate,
          syncStatus: 'SYNCED',
        },
      });
    } catch (err) {
      if (!(err instanceof GoogleCalendarError)) throw err;

      if (err.kind === 'invalid_grant') {
        await this.handleInvalidGrant(connection.id);
        return;
      }

      if (err.kind === 'gone' && existingLink) {
        // design.md "404/410 on patch or delete: drop the link; on patch,
        // recreate" -- el evento fue borrado en Google o el link quedó
        // obsoleto. Se descarta y se reintenta una vez como insert fresco
        // (existingLink ya no existe en el segundo paso, así que no hay
        // riesgo de recursión infinita).
        await this.prisma.calendarEventLink
          .delete({ where: { id: existingLink.id } })
          .catch(() => undefined);
        await this.pushConsultation(connection, consultation);
        return;
      }

      // transient (403 rate-limit/5xx/red): queda logueado y, si había un
      // link previo, marcado FAILED para que el reconciler lo reintente
      // (design.md "the next reconcile tick retries"). Un insert fallido
      // sin link previo no deja rastro -- el backfill del reconciler lo
      // vuelve a intentar mientras la sesión siga en la ventana.
      this.logger.error(
        `Fallo al sincronizar groupId=${consultation.groupId} con Google Calendar: ${err.message}`,
      );
      if (existingLink) {
        await this.prisma.calendarEventLink.update({
          where: { id: existingLink.id },
          data: { syncStatus: 'FAILED', lastError: err.message },
        });
      }
    }
  }

  private async deleteLinkForGroup(
    connection: GoogleCalendarConnection,
    groupId: string,
  ): Promise<void> {
    const link = await this.prisma.calendarEventLink.findUnique({
      where: {
        connectionId_groupId: { connectionId: connection.id, groupId },
      },
    });
    if (!link) return;

    const oauth2Client = this.buildOAuth2Client(connection);
    try {
      await this.googleCalendarClient.deleteEvent(
        oauth2Client,
        connection.calendarId,
        link.googleEventId,
      );
    } catch (err) {
      if (!(err instanceof GoogleCalendarError)) throw err;

      if (err.kind === 'invalid_grant') {
        await this.handleInvalidGrant(connection.id);
        return;
      }
      if (err.kind === 'transient') {
        this.logger.error(
          `No se pudo eliminar el evento de Google (groupId=${groupId}): ${err.message}`,
        );
        // La condición que disparó este borrado (deletedAt) persiste, así
        // que el próximo tick del reconciler lo vuelve a intentar -- no
        // hace falta un estado FAILED separado para esta rama.
        return;
      }
      // 'gone': el evento ya no existe en Google -- se procede a limpiar el
      // link igual, es exactamente el estado final deseado.
    }

    await this.prisma.calendarEventLink
      .delete({ where: { id: link.id } })
      .catch(() => undefined);
  }

  // design.md "Failure classification": invalid_grant/401 -> solo la
  // transición ganadora (CONNECTED -> DISCONNECTED) notifica, mismo patrón
  // de "claim" atómico que CalendarOauthService.verifyAndConsumeState /
  // RemindersService.claimAndDispatch -- una segunda falla concurrente sobre
  // una conexión ya DISCONNECTED nunca vuelve a notificar (T6.5/T6.6).
  private async handleInvalidGrant(connectionId: string): Promise<void> {
    const result = await this.prisma.googleCalendarConnection.updateMany({
      where: { id: connectionId, status: 'CONNECTED' },
      data: {
        status: 'DISCONNECTED',
        disconnectReason: 'INVALID_GRANT',
        disconnectedAt: new Date(),
        refreshTokenEncrypted: null,
        scope: null,
        lastError: 'invalid_grant',
      },
    });
    if (result.count === 0) return;

    const connection = await this.prisma.googleCalendarConnection.findUnique({
      where: { id: connectionId },
      select: { therapistId: true },
    });
    if (!connection) return;

    await this.notificationsService.create({
      userId: connection.therapistId,
      type: NotificationType.GOOGLE_CALENDAR_DISCONNECTED,
      title: 'Se desconectó tu Google Calendar',
      body: 'Tu autorización de Google Calendar dejó de ser válida. Reconéctala desde Ajustes para seguir sincronizando tus sesiones.',
      linkPath: '/settings',
    });
  }

  // design.md "Minimized event body, fixed 50-minute duration": solo
  // iniciales + código corto + deep link -- nunca rut, fullName completo,
  // sessionType ni texto clínico (T6.3/T6.4). Consultation no tiene columna
  // de duración, de ahí DEFAULT_SESSION_MINUTES.
  private buildEventBody(
    consultation: SyncableConsultation,
  ): GoogleCalendarEventBody {
    const start = consultation.sessionDate;
    const end = new Date(start.getTime() + DEFAULT_SESSION_MINUTES * 60 * 1000);
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? DEFAULT_FRONTEND_URL;
    const label = patientLabel(consultation.patient);

    return {
      summary: `Sesión — ${label}`,
      description: `${frontendUrl}/consultations/${consultation.id}\n\nGestionado por Umbral — los cambios hechos aquí no vuelven a Umbral.`,
      start: { dateTime: start.toISOString(), timeZone: CALENDAR_TIME_ZONE },
      end: { dateTime: end.toISOString(), timeZone: CALENDAR_TIME_ZONE },
      extendedProperties: { private: { umbralGroupId: consultation.groupId } },
    };
  }

  private buildOAuth2Client(
    connection: GoogleCalendarConnection,
  ): OAuth2Client {
    const refreshToken = this.tokenCrypto
      .decrypt(Buffer.from(connection.refreshTokenEncrypted as Buffer))
      .toString('utf-8');

    const client = new OAuth2Client({
      clientId: this.config.get<string>('GOOGLE_CLIENT_ID'),
      clientSecret: this.config.get<string>('GOOGLE_CLIENT_SECRET'),
    });
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }
}
