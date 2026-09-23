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

  it('leaves events without a request untouched', () => {
    const event = { type: undefined, message: 'boom' } as ErrorEvent;

    expect(scrubEvent(event)).toEqual({ type: undefined, message: 'boom' });
  });
});
