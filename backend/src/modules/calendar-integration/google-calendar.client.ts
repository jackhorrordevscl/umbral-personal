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

  private async request<T = void>(
    oauth2Client: OAuth2Client,
    method: 'POST' | 'PATCH' | 'DELETE',
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
          'Content-Type': 'application/json',
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
