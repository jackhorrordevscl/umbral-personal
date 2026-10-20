import { Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { MAX_BUSY_PAGES } from './calendar-integration.constants';

// design.md "The access token is never persisted": este cliente recibe un
// OAuth2Client ya cargado con el refresh token de una conexión concreta
// (armado por CalendarSyncService), pide un access_token en memoria por
// llamada, y habla con las tres rutas de Calendar necesarias vía fetch
// nativo -- google-auth-library, no googleapis (evita traer toda la
// superficie de la API de Google solo para insert/patch/delete).
export type GoogleCalendarFailureKind =
  | 'invalid_grant'
  | 'gone'
  | 'conflict'
  | 'transient';

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
  // issue #497: `id` lo elige el cliente en el insert; `status: 'confirmed'`
  // en el patch resucita un evento que el terapeuta borró (queda cancelled).
  id?: string;
  status?: 'confirmed';
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

// Tope por llamada a Google (refresh del token y cada request). Sin él, una
// conexión colgada bloquea reconcile() indefinidamente (issue #286).
export const GOOGLE_REQUEST_TIMEOUT_MS = 15_000;

// ¿El endpoint de tokens rechazó la credencial? google-auth-library lanza un
// GaxiosError con response.status y response.data.error; si el shape no
// viene, el mensaje 'invalid_grant' sigue contando. Todo lo demás (DNS,
// reset de conexión, 5xx) es transitorio.
function isTokenRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const { response } = err as {
    response?: { status?: number; data?: { error?: unknown } };
  };
  if (response?.status === 400 || response?.status === 401) return true;
  return (
    response?.data?.error === 'invalid_grant' ||
    err.message.includes('invalid_grant')
  );
}

@Injectable()
export class GoogleCalendarClient {
  private readonly logger = new Logger(GoogleCalendarClient.name);

  async insertEvent(
    oauth2Client: OAuth2Client,
    calendarId: string,
    event: GoogleCalendarEventBody,
    eventId: string,
  ): Promise<GoogleCalendarEventResponse> {
    try {
      return await this.request<GoogleCalendarEventResponse>(
        oauth2Client,
        'POST',
        this.eventsUrl(calendarId),
        { ...event, id: eventId },
      );
    } catch (err) {
      // issue #497: 409 = ese id ya existe, o porque un intento anterior sí
      // llegó a Google aunque su respuesta se perdió, o porque el evento fue
      // borrado (Google lo conserva cancelado y no deja reusar el id). En
      // ambos casos el estado deseado es "el evento existe y está
      // confirmado": se parchea con status confirmed en vez de duplicarlo.
      if (err instanceof GoogleCalendarError && err.kind === 'conflict') {
        return this.patchEvent(oauth2Client, calendarId, eventId, {
          ...event,
          status: 'confirmed',
        });
      }
      throw err;
    }
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
    let pages = 0;

    do {
      // issue #497: sin tope, un calendario patológico (o un nextPageToken que
      // nunca termina) dejaría el refresh paginando sin límite.
      if (++pages > MAX_BUSY_PAGES) {
        throw new GoogleCalendarError(
          'transient',
          `events.list superó ${MAX_BUSY_PAGES} páginas en la ventana de ocupación.`,
        );
      }
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

  // google-auth-library no acepta un AbortSignal en getAccessToken(), así que
  // se compite contra un timer; la llamada subyacente puede seguir en vuelo,
  // pero el tick ya no queda esperándola.
  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new GoogleCalendarError(
              'transient',
              `Google no respondió al refrescar el access_token en ${GOOGLE_REQUEST_TIMEOUT_MS} ms.`,
            ),
          ),
        GOOGLE_REQUEST_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Separado de request() para que un fallo al refrescar el access_token
  // (p. ej. el refresh token fue revocado en Google) se clasifique como
  // invalid_grant sin llegar a intentar el fetch. Solo cuenta como credencial
  // inválida un rechazo del endpoint de tokens (400/401 o error invalid_grant);
  // google-auth-library no garantiza un shape de error consistente, por eso
  // se inspecciona de forma defensiva.
  private async getAccessToken(oauth2Client: OAuth2Client): Promise<string> {
    let token: string | null | undefined;
    try {
      ({ token } = await this.withTimeout(oauth2Client.getAccessToken()));
    } catch (err) {
      // Un timeout, una caída de red o un 5xx no dicen nada sobre la
      // credencial: tratarlos como invalid_grant desconectaría al terapeuta.
      if (err instanceof GoogleCalendarError) throw err;
      const detail = `Fallo al refrescar el access_token: ${err instanceof Error ? err.message : String(err)}`;
      throw new GoogleCalendarError(
        isTokenRejection(err) ? 'invalid_grant' : 'transient',
        detail,
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
        signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
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

    // Solo el POST del insert interpreta un 409 (id ya existente); en
    // patch/delete/list sigue siendo transient, como antes de #497.
    if (response.status === 409 && method === 'POST') {
      throw new GoogleCalendarError(
        'conflict',
        `Google Calendar devolvió 409 (${method} ${url}).`,
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
