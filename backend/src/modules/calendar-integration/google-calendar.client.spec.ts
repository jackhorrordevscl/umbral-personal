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

// sdd/public-booking-payment-calendar PR 1 (T1.5): helper para simular la
// respuesta paginada de events.list -- distinto de mockFetchOnce porque acá
// el body es {items, nextPageToken}, no {id}.
function mockFetchListOnce(body: {
  items?: unknown[];
  nextPageToken?: string;
}) {
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
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

  // sdd/public-booking-payment-calendar PR 1 (T1.4/T1.5, design.md Decision
  // 1): mapeo puro de events.list -> BusyInterval[], sin llamar a Google de
  // verdad. WINDOW_START/END son arbitrarios -- el mapeo no depende de su
  // valor real, solo se usan para armar la query.
  describe('listBusyIntervals', () => {
    const WINDOW_START = new Date('2026-02-01T00:00:00.000Z');
    const WINDOW_END = new Date('2026-04-02T00:00:00.000Z');

    it('mapea eventos con horario (start/end dateTime) a BusyInterval[]', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchListOnce({
        items: [
          {
            start: { dateTime: '2026-02-10T10:00:00-03:00' },
            end: { dateTime: '2026-02-10T11:00:00-03:00' },
          },
          {
            start: { dateTime: '2026-02-11T09:00:00-03:00' },
            end: { dateTime: '2026-02-11T09:30:00-03:00' },
          },
        ],
      });

      const result = await client.listBusyIntervals(
        oauth2Client,
        CALENDAR_ID,
        WINDOW_START,
        WINDOW_END,
      );

      expect(result).toEqual([
        {
          startsAt: new Date('2026-02-10T10:00:00-03:00'),
          endsAt: new Date('2026-02-10T11:00:00-03:00'),
        },
        {
          startsAt: new Date('2026-02-11T09:00:00-03:00'),
          endsAt: new Date('2026-02-11T09:30:00-03:00'),
        },
      ]);
    });

    it('arma la query con timeMin/timeMax/singleEvents/showDeleted/fields y GET', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchListOnce({ items: [] });

      await client.listBusyIntervals(
        oauth2Client,
        CALENDAR_ID,
        WINDOW_START,
        WINDOW_END,
      );

      const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(init.method).toBe('GET');
      expect(url).toContain('/calendars/primary/events?');
      expect(url).toContain(
        `timeMin=${encodeURIComponent(WINDOW_START.toISOString())}`,
      );
      expect(url).toContain(
        `timeMax=${encodeURIComponent(WINDOW_END.toISOString())}`,
      );
      expect(url).toContain('singleEvents=true');
      expect(url).toContain('showDeleted=false');
      expect(url).toContain(
        new URLSearchParams({
          fields:
            'items(start,end,status,transparency,extendedProperties),nextPageToken',
        }).toString(),
      );
    });

    it('descarta eventos cancelados (status=cancelled)', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchListOnce({
        items: [
          {
            status: 'cancelled',
            start: { dateTime: '2026-02-10T10:00:00-03:00' },
            end: { dateTime: '2026-02-10T11:00:00-03:00' },
          },
        ],
      });

      const result = await client.listBusyIntervals(
        oauth2Client,
        CALENDAR_ID,
        WINDOW_START,
        WINDOW_END,
      );

      expect(result).toEqual([]);
    });

    it('descarta eventos transparentes (transparency=transparent)', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchListOnce({
        items: [
          {
            transparency: 'transparent',
            start: { dateTime: '2026-02-10T10:00:00-03:00' },
            end: { dateTime: '2026-02-10T11:00:00-03:00' },
          },
        ],
      });

      const result = await client.listBusyIntervals(
        oauth2Client,
        CALENDAR_ID,
        WINDOW_START,
        WINDOW_END,
      );

      expect(result).toEqual([]);
    });

    it('descarta eventos de todo el día (start.date, sin start.dateTime)', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchListOnce({
        items: [
          {
            start: { date: '2026-02-10' },
            end: { date: '2026-02-11' },
          },
        ],
      });

      const result = await client.listBusyIntervals(
        oauth2Client,
        CALENDAR_ID,
        WINDOW_START,
        WINDOW_END,
      );

      expect(result).toEqual([]);
    });

    it('descarta eventos propios de Umbral (extendedProperties.private.umbralGroupId)', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchListOnce({
        items: [
          {
            start: { dateTime: '2026-02-10T10:00:00-03:00' },
            end: { dateTime: '2026-02-10T11:00:00-03:00' },
            extendedProperties: { private: { umbralGroupId: 'group-1' } },
          },
        ],
      });

      const result = await client.listBusyIntervals(
        oauth2Client,
        CALENDAR_ID,
        WINDOW_START,
        WINDOW_END,
      );

      expect(result).toEqual([]);
    });

    it('sigue la paginación hasta el final y concatena todas las páginas', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchListOnce({
        items: [
          {
            start: { dateTime: '2026-02-10T10:00:00-03:00' },
            end: { dateTime: '2026-02-10T11:00:00-03:00' },
          },
        ],
        nextPageToken: 'page-2-token',
      });
      mockFetchListOnce({
        items: [
          {
            start: { dateTime: '2026-02-12T14:00:00-03:00' },
            end: { dateTime: '2026-02-12T15:00:00-03:00' },
          },
        ],
      });

      const result = await client.listBusyIntervals(
        oauth2Client,
        CALENDAR_ID,
        WINDOW_START,
        WINDOW_END,
      );

      expect(result).toEqual([
        {
          startsAt: new Date('2026-02-10T10:00:00-03:00'),
          endsAt: new Date('2026-02-10T11:00:00-03:00'),
        },
        {
          startsAt: new Date('2026-02-12T14:00:00-03:00'),
          endsAt: new Date('2026-02-12T15:00:00-03:00'),
        },
      ]);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      const [secondUrl] = (globalThis.fetch as jest.Mock).mock.calls[1] as [
        string,
      ];
      expect(secondUrl).toContain('pageToken=page-2-token');
    });

    it('clasifica un 401 durante events.list como invalid_grant (reusa GoogleCalendarError)', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchOnce({ ok: false, status: 401 });

      await expect(
        client.listBusyIntervals(
          oauth2Client,
          CALENDAR_ID,
          WINDOW_START,
          WINDOW_END,
        ),
      ).rejects.toMatchObject({
        kind: 'invalid_grant',
      } as Partial<GoogleCalendarError>);
    });

    it('clasifica un 403 (quota) durante events.list como transient', async () => {
      const oauth2Client = buildOAuth2Client();
      mockFetchOnce({ ok: false, status: 403 });

      await expect(
        client.listBusyIntervals(
          oauth2Client,
          CALENDAR_ID,
          WINDOW_START,
          WINDOW_END,
        ),
      ).rejects.toMatchObject({
        kind: 'transient',
      } as Partial<GoogleCalendarError>);
    });
  });
});
