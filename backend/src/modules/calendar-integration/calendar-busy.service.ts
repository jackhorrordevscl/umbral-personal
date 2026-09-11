import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { GoogleCalendarConnection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { CalendarSyncService } from './calendar-sync.service';
import {
  GoogleCalendarClient,
  GoogleCalendarError,
} from './google-calendar.client';
import {
  BUSY_REFRESH_CONCURRENCY,
  BUSY_WINDOW_DAYS,
} from './calendar-integration.constants';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// sdd/public-booking-payment-calendar PR 2 (design.md Decision 3/4, tasks.md
// 2.1): refresca CalendarBusyBlock cada 30 minutos leyendo events.list vía
// GoogleCalendarClient.listBusyIntervals() (PR 1), reemplaza las filas de
// cada terapeuta en una transacción, y llama
// AvailabilityService.invalidate() tras un write exitoso (design.md
// Decision 3: "a refreshed overlay takes effect immediately instead of
// waiting out the 5-minute TTL"). Reusa
// CalendarSyncService.buildOAuth2Client()/handleInvalidGrant() -- mismo
// OAuth2Client y misma clasificación de invalid_grant que el push sync
// (evita que los dos jobs diverjan).
//
// NOTA (deviation, ver apply-progress/PR2): tasks.md 2.1 pide "skip
// connections without the read scope" leyendo un campo de scope que PR 3
// introduciría -- el spike de PR 0 confirmó que events.list funciona bajo el
// scope calendar.events ya existente, sin re-consentimiento, así que esa
// verificación de scope NO es necesaria acá y se omite por instrucción
// explícita (contexto de sesión). El job simplemente itera toda conexión
// CONNECTED.
//
// Cada conexión se procesa de forma aislada (try/catch propio dentro de
// refreshConnection, más un .catch() defensivo en el Promise.all de
// refresh()) -- un fallo de una conexión nunca debe frenar el resto del
// batch ni escapar como una excepción no manejada del cron (mismo criterio
// que CalendarSyncService.reconcile).
@Injectable()
export class CalendarBusyService {
  private readonly logger = new Logger(CalendarBusyService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleCalendarClient: GoogleCalendarClient,
    private readonly calendarSyncService: CalendarSyncService,
    private readonly availabilityService: AvailabilityService,
    private readonly config: ConfigService,
  ) {
    // design.md "Migration / Rollout": ambos flags de este change son
    // opt-in explícito (=== 'true'), NO el "!== 'false'" default-on de los
    // módulos de sync más viejos (GOOGLE_CALENDAR_SYNC_ENABLED) -- ver
    // tasks.md 2.2 (discrepancia spec vs. design.md, resuelta a favor de
    // design.md por ser la fuente más específica y validada más tarde).
    this.enabled =
      this.config.get<string>('CALENDAR_AVAILABILITY_OVERLAY_ENABLED') ===
      'true';
  }

  @Cron('*/30 * * * *')
  async refresh(): Promise<void> {
    if (!this.enabled) return;

    const connections = await this.prisma.googleCalendarConnection.findMany({
      where: { status: 'CONNECTED' },
    });

    for (let i = 0; i < connections.length; i += BUSY_REFRESH_CONCURRENCY) {
      const batch = connections.slice(i, i + BUSY_REFRESH_CONCURRENCY);
      await Promise.all(
        batch.map((connection) =>
          this.refreshConnection(connection).catch((err: unknown) => {
            // Red de seguridad adicional: refreshConnection ya atrapa todo
            // lo esperable (invalid_grant, transient) -- esto solo cubre un
            // fallo verdaderamente inesperado (p. ej. handleInvalidGrant
            // mismo throweando), para que "el job nunca throwea" siga
            // siendo cierto incluso ahí.
            this.logger.error(
              `CalendarBusyService: fallo inesperado refrescando therapistId=${connection.therapistId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }),
        ),
      );
    }
  }

  private async refreshConnection(
    connection: GoogleCalendarConnection,
  ): Promise<void> {
    try {
      const oauth2Client =
        this.calendarSyncService.buildOAuth2Client(connection);
      const now = new Date();
      const timeMax = new Date(now.getTime() + BUSY_WINDOW_DAYS * MS_PER_DAY);

      const intervals = await this.googleCalendarClient.listBusyIntervals(
        oauth2Client,
        connection.calendarId,
        now,
        timeMax,
      );

      await this.prisma.$transaction([
        this.prisma.calendarBusyBlock.deleteMany({
          where: { therapistId: connection.therapistId },
        }),
        this.prisma.calendarBusyBlock.createMany({
          data: intervals.map((interval) => ({
            therapistId: connection.therapistId,
            startsAt: interval.startsAt,
            endsAt: interval.endsAt,
          })),
        }),
        this.prisma.googleCalendarConnection.update({
          where: { id: connection.id },
          data: { busySyncedAt: now, busySyncError: null },
        }),
      ]);

      this.availabilityService.invalidate(connection.therapistId);
    } catch (err) {
      if (err instanceof GoogleCalendarError && err.kind === 'invalid_grant') {
        await this.calendarSyncService.handleInvalidGrant(connection.id);
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `CalendarBusyService: fallo al refrescar busy blocks therapistId=${connection.therapistId}: ${message}`,
      );
      await this.prisma.googleCalendarConnection
        .update({
          where: { id: connection.id },
          data: { busySyncError: message },
        })
        .catch(() => undefined);
    }
  }
}
