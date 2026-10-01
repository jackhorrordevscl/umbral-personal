import type { ErrorEvent } from '@sentry/node';
import { scrubEvent } from './instrument';

describe('scrubEvent', () => {
  it('strips body, cookies, headers and query string from the request', () => {
    const event = {
      type: undefined,
      message: 'boom',
      request: {
        url: 'https://api.example.com/api/v1/patients',
        method: 'POST',
        data: { rut: '11.111.111-1' },
        cookies: { session: 'abc' },
        headers: { authorization: 'Bearer secret' },
        query_string: 'email=a@b.cl',
      },
    } as ErrorEvent;

    const result = scrubEvent(event);

    expect(result.request).toEqual({
      url: 'https://api.example.com/api/v1/patients',
      method: 'POST',
    });
    expect(result.message).toBe('boom');
  });

  it('redacts emails and RUTs from exception values and the message (issue #283)', () => {
    const event = {
      type: undefined,
      message: 'fallo para ana@correo.cl',
      exception: {
        values: [
          {
            type: 'PrismaClientKnownRequestError',
            value: 'Unique constraint failed on rut 12.345.678-5 / 9876543-K',
          },
        ],
      },
    } as ErrorEvent;

    const result = scrubEvent(event);

    expect(result.message).toBe('fallo para [redacted-email]');
    expect(result.exception?.values?.[0].value).toBe(
      'Unique constraint failed on rut [redacted-rut] / [redacted-rut]',
    );
  });

  it('redacts breadcrumb messages and drops their data (issue #283)', () => {
    const event = {
      type: undefined,
      breadcrumbs: [
        {
          message: 'query for ana@correo.cl',
          data: { params: ['12.345.678-5'] },
        },
        { category: 'http', data: { url: '/x' } },
      ],
    } as ErrorEvent;

    const result = scrubEvent(event);

    expect(result.breadcrumbs).toEqual([
      { message: 'query for [redacted-email]' },
      { category: 'http' },
    ]);
  });

  it('leaves events without a request untouched', () => {
    const event = { type: undefined, message: 'boom' } as ErrorEvent;

    expect(scrubEvent(event)).toEqual({ type: undefined, message: 'boom' });
  });
});
