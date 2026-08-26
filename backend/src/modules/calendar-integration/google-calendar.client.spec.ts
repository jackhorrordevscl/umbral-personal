import { OAuth2Client } from 'google-auth-library';
import {
  GoogleCalendarClient,
  GoogleCalendarError,
} from './google-calendar.client';

// sdd/google-calendar-integration PR 2 (T4.2): cliente delgado sobre
// google-auth-library.OAuth2Client + fetch nativo (design.md "The access
// token is never persisted" -- not googleapis). Estos tests cubren la
// clasificación tipada de errores (design.md "Failure classification"):
// invalid_grant/401 -> reconectar; 404/410 -> gone; 403/5xx/network ->
// transient (reintenta el próximo tick del reconciler).
function buildOAuth2Client(
  token: string | null | undefined = 'fake-access-token',
) {
  return {
    getAccessToken: jest.fn().mockResolvedValue({ token }),
  } as unknown as OAuth2Client;
}

function mockFetchOnce(
  response: Partial<Response> & { ok: boolean; status: number },
) {
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
    json: jest.fn().mockResolvedValue({ id: 'google-event-1' }),
    ...response,
  });
}

describe('GoogleCalendarClient', () => {
  let client: GoogleCalendarClient;
  const CALENDAR_ID = 'primary';
  const EVENT_BODY = {
    summary: 'Sesión — JM-4K7QX2',
    description: 'https://umbral.cl/consultations/1',
    start: { dateTime: '2026-01-10T12:00:00', timeZone: 'America/Santiago' },
    end: { dateTime: '2026-01-10T12:50:00', timeZone: 'America/Santiago' },
    extendedProperties: { private: { umbralGroupId: 'group-1' } },
  };

  beforeEach(() => {
    client = new GoogleCalendarClient();
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('insertEvent', () => {
    it('devuelve el id del evento creado en una respuesta 200/201 ok', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchOnce({ ok: true, status: 200 });

      const result = await client.insertEvent(
        oauth2Client,
        CALENDAR_ID,
        EVENT_BODY,
      );

      expect(result).toEqual({ id: 'google-event-1' });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/calendars/primary/events'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer fake-access-token',
          }) as unknown,
        }),
      );
    });

    it('clasifica un 401 como invalid_grant', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchOnce({ ok: false, status: 401 });

      await expect(
        client.insertEvent(oauth2Client, CALENDAR_ID, EVENT_BODY),
      ).rejects.toMatchObject({
        kind: 'invalid_grant',
      } as Partial<GoogleCalendarError>);
    });

    it('clasifica un fallo al refrescar el access_token como invalid_grant', async () => {
      const oauth2Client = {
        getAccessToken: jest.fn().mockRejectedValue(new Error('invalid_grant')),
      } as unknown as OAuth2Client;

      await expect(
        client.insertEvent(oauth2Client, CALENDAR_ID, EVENT_BODY),
      ).rejects.toMatchObject({
        kind: 'invalid_grant',
      } as Partial<GoogleCalendarError>);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('clasifica un 403 (rate limit) como transient', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchOnce({ ok: false, status: 403 });

      await expect(
        client.insertEvent(oauth2Client, CALENDAR_ID, EVENT_BODY),
      ).rejects.toMatchObject({
        kind: 'transient',
      } as Partial<GoogleCalendarError>);
    });

    it('clasifica un 500 como transient', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchOnce({ ok: false, status: 500 });

      await expect(
        client.insertEvent(oauth2Client, CALENDAR_ID, EVENT_BODY),
      ).rejects.toMatchObject({
        kind: 'transient',
      } as Partial<GoogleCalendarError>);
    });

    it('clasifica un error de red como transient', async () => {
      const oauth2Client = buildOAuth2Client();
      (globalThis.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('ECONNRESET'),
      );

      await expect(
        client.insertEvent(oauth2Client, CALENDAR_ID, EVENT_BODY),
      ).rejects.toMatchObject({
        kind: 'transient',
      } as Partial<GoogleCalendarError>);
    });
  });

  describe('patchEvent', () => {
    it('clasifica un 404 como gone', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchOnce({ ok: false, status: 404 });

      await expect(
        client.patchEvent(
          oauth2Client,
          CALENDAR_ID,
          'google-event-1',
          EVENT_BODY,
        ),
      ).rejects.toMatchObject({ kind: 'gone' } as Partial<GoogleCalendarError>);
    });

    it('clasifica un 410 como gone', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchOnce({ ok: false, status: 410 });

      await expect(
        client.patchEvent(
          oauth2Client,
          CALENDAR_ID,
          'google-event-1',
          EVENT_BODY,
        ),
      ).rejects.toMatchObject({ kind: 'gone' } as Partial<GoogleCalendarError>);
    });

    it('hace PATCH al evento existente y devuelve su id', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchOnce({ ok: true, status: 200 });

      const result = await client.patchEvent(
        oauth2Client,
        CALENDAR_ID,
        'google-event-1',
        EVENT_BODY,
      );

      expect(result).toEqual({ id: 'google-event-1' });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/events/google-event-1'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  describe('deleteEvent', () => {
    it('hace DELETE al evento y no lanza en un 200 ok', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchOnce({ ok: true, status: 204 });

      await expect(
        client.deleteEvent(oauth2Client, CALENDAR_ID, 'google-event-1'),
      ).resolves.toBeUndefined();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/events/google-event-1'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('clasifica un 404 en delete como gone (evento ya no existe)', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchOnce({ ok: false, status: 404 });

      await expect(
        client.deleteEvent(oauth2Client, CALENDAR_ID, 'google-event-1'),
      ).rejects.toMatchObject({ kind: 'gone' } as Partial<GoogleCalendarError>);
    });
  });
});
