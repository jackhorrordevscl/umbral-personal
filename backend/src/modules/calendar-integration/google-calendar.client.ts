import { Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

// design.md "The access token is never persisted": este cliente recibe un
// OAuth2Client ya cargado con el refresh token de una conexión concreta
// (armado por CalendarSyncService), pide un access_token en memoria por
// llamada, y habla con las tres rutas de Calendar necesarias vía fetch
// nativo -- google-auth-library, no googleapis (evita traer toda la
// superficie de la API de Google solo para insert/patch/delete).
export type GoogleCalendarFailureKind = 'invalid_grant' | 'gone' | 'transient';

// design.md "Failure classification": invalid_grant/401 en el refresh ->
// CalendarSyncService desconecta y notifica; gone (404/410) -> el link se
// descarta (y se recrea si era un patch); transient (403 rate-limit/5xx/red)
// -> queda FAILED, el próximo reconcile tick reintenta. Ninguna de las tres
// se propaga jamás a la escritura clínica que la disparó.
export class GoogleCalendarError extends Error {
  constructor(
    public readonly kind: GoogleCalendarFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleCalendarError';
  }
}

export interface GoogleCalendarEventBody {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties: { private: Record<string, string> };
}

interface GoogleCalendarEventResponse {
  id: string;
}

// sdd/public-booking-payment-calendar PR 1 (design.md "Interfaces /
// Contracts"): forma mínima que listBusyIntervals() devuelve -- se mergea
// tal cual dentro de blockouts[] en computeSlots() (PR 2), mismo shape que
// BlockoutInput ({startsAt, endsAt}).
export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
}

// design.md Decision 1: el `fields` mask que se manda a Google -- Google
// nunca devuelve summary/description/attendees/location con esta máscara,
// así que ningún contenido clínico ni personal entra al proceso.
const BUSY_EVENT_FIELDS =
  'items(start,end,status,transparency,extendedProperties),nextPageToken';

// Shape mínimo que este cliente lee de cada item de events.list -- nunca el
// evento completo de Google (design.md Decision 1: privacidad por
// field-mask, no por filtrado post-hoc).
interface GoogleCalendarListEventItem {
  status?: string;
  transparency?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
}

interface GoogleCalendarListEventsResponse {
  items?: GoogleCalendarListEventItem[];
  nextPageToken?: string;
}

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

@Injectable()
export class GoogleCalendarClient {
  private readonly logger = new Logger(GoogleCalendarClient.name);

  async insertEvent(
    oauth2Client: OAuth2Client,
    calendarId: string,
    event: GoogleCalendarEventBody,
  ): Promise<GoogleCalendarEventResponse> {
    return this.request<GoogleCalendarEventResponse>(
      oauth2Client,
      'POST',
      this.eventsUrl(calendarId),
      event,
    );
  }

  async patchEvent(
    oauth2Client: OAuth2Client,
    calendarId: string,
    eventId: string,
    event: Partial<GoogleCalendarEventBody>,
  ): Promise<GoogleCalendarEventResponse> {
    return this.request<GoogleCalendarEventResponse>(
      oauth2Client,
      'PATCH',
      this.eventUrl(calendarId, eventId),
      event,
    );
  }

  async deleteEvent(
    oauth2Client: OAuth2Client,
    calendarId: string,
    eventId: string,
  ): Promise<void> {
    await this.request(
      oauth2Client,
      'DELETE',
      this.eventUrl(calendarId, eventId),
    );
  }

  // T1.4 (design.md Decision 1): lee eventos con `events.list` bajo el
  // scope `calendar.events` existente -- sin freebusy.query, sin scope
  // nuevo. Pagina hasta agotar nextPageToken y descarta, vía
  // toBusyInterval(), todo lo que no represente un bloqueo real (cancelado,
  // transparente, de todo el día, o pusheado por el propio Umbral).
  async listBusyIntervals(
    oauth2Client: OAuth2Client,
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<BusyInterval[]> {
    const intervals: BusyInterval[] = [];
    let pageToken: string | undefined;

    do {
      const query: Record<string, string> = {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        showDeleted: 'false',
        fields: BUSY_EVENT_FIELDS,
      };
      if (pageToken) query.pageToken = pageToken;

      const url = `${this.eventsUrl(calendarId)}?${new URLSearchParams(query).toString()}`;
      const response = await this.request<GoogleCalendarListEventsResponse>(
        oauth2Client,
        'GET',
        url,
      );

      for (const item of response.items ?? []) {
        const interval = this.toBusyInterval(item);
        if (interval) intervals.push(interval);
      }

      pageToken = response.nextPageToken;
    } while (pageToken);

    return intervals;
  }

  // design.md Decision 1: descarta cancelados, transparentes, de todo el
  // día (start.date sin start.dateTime -- un marcador de día no bloquea) y
  // los que Umbral mismo pusheó (extendedProperties.private.umbralGroupId,
  // ya reflejados en Consultation, incluirlos duplicaría el bloqueo).
  private toBusyInterval(
    item: GoogleCalendarListEventItem,
  ): BusyInterval | null {
    if (item.status === 'cancelled') return null;
    if (item.transparency === 'transparent') return null;
    if (!item.start?.dateTime || !item.end?.dateTime) return null;
    if (item.extendedProperties?.private?.umbralGroupId) return null;

    return {
      startsAt: new Date(item.start.dateTime),
      endsAt: new Date(item.end.dateTime),
    };
  }

  private eventsUrl(calendarId: string): string {
    return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
  }

  private eventUrl(calendarId: string, eventId: string): string {
    return `${this.eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`;
  }

  // Separado de request() para que un fallo al refrescar el access_token
  // (p. ej. el refresh token fue revocado en Google) se clasifique siempre
  // como invalid_grant sin llegar a intentar el fetch -- google-auth-library
  // no garantiza un shape de error consistente acá, así que cualquier
  // rechazo en este paso se trata como credencial inválida.
  private async getAccessToken(oauth2Client: OAuth2Client): Promise<string> {
    let token: string | null | undefined;
    try {
      ({ token } = await oauth2Client.getAccessToken());
    } catch (err) {
      throw new GoogleCalendarError(
        'invalid_grant',
        `Fallo al refrescar el access_token: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!token) {
      throw new GoogleCalendarError(
        'invalid_grant',
        'Google no devolvió un access_token utilizable.',
      );
    }
    return token;
  }

  // GET agregado en T1.4 (listBusyIntervals) reusando la misma
  // clasificación de errores que insertEvent/patchEvent/deleteEvent ya
  // tenían (design.md "Failure classification", reuse requirement de
  // calendar-sync spec). Content-Type solo se manda cuando hay body --
  // GET nunca lo tiene.
  private async request<T = void>(
    oauth2Client: OAuth2Client,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
  ): Promise<T> {
    const accessToken = await this.getAccessToken(oauth2Client);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new GoogleCalendarError(
        'transient',
        `Error de red hacia Google Calendar: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (response.ok) {
      if (method === 'DELETE') return undefined as T;
      return (await response.json()) as T;
    }

    if (response.status === 401) {
      throw new GoogleCalendarError(
        'invalid_grant',
        `Google Calendar devolvió 401 (${method} ${url}).`,
      );
    }
    if (response.status === 404 || response.status === 410) {
      throw new GoogleCalendarError(
        'gone',
        `Google Calendar devolvió ${response.status} (${method} ${url}).`,
      );
    }

    // 403 (rate limit) / 5xx quedan clasificados como transient
    // (design.md "Failure classification"): el próximo reconcile tick
    // reintenta, nunca se reintenta inline.
    this.logger.error(
      `Google Calendar devolvió ${response.status} (${method} ${url}).`,
    );
    throw new GoogleCalendarError(
      'transient',
      `Google Calendar devolvió ${response.status} (${method} ${url}).`,
    );
  }
}
