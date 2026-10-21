import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { CalendarIntegrationController } from './calendar-integration.controller';
import { CalendarOauthService } from './calendar-oauth.service';
import {
  CALENDAR_OAUTH_COOKIE_NAME,
  extractCalendarOauthCookie,
} from './calendar-oauth-cookie';
import { STATE_TTL_MS } from './calendar-integration.constants';

// issue #497: el state de OAuth va atado al navegador por una cookie que deja
// POST /authorize y que GET /callback exige y descarta siempre.
describe('CalendarIntegrationController — cookie del state OAuth', () => {
  let oauthService: {
    buildAuthorizationUrl: jest.Mock;
    verifyAndConsumeState: jest.Mock;
    exchangeCodeAndPersist: jest.Mock;
  };
  let controller: CalendarIntegrationController;
  let res: { cookie: jest.Mock; clearCookie: jest.Mock; redirect: jest.Mock };

  beforeEach(() => {
    oauthService = {
      buildAuthorizationUrl: jest
        .fn()
        .mockResolvedValue({ url: 'https://google/auth', bindingToken: 'tok' }),
      verifyAndConsumeState: jest
        .fn()
        .mockResolvedValue({ therapistId: 'therapist-1' }),
      exchangeCodeAndPersist: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      get: (key: string) =>
        key === 'FRONTEND_URL' ? 'https://app.umbral.cl' : undefined,
    } as unknown as ConfigService;
    controller = new CalendarIntegrationController(
      oauthService as unknown as CalendarOauthService,
      config,
    );
    res = { cookie: jest.fn(), clearCookie: jest.fn(), redirect: jest.fn() };
  });

  function reqWithCookie(cookie?: string): Request {
    return { headers: cookie ? { cookie } : {} } as unknown as Request;
  }

  it('authorize devuelve solo la url y deja la cookie HttpOnly SameSite=Lax con el secreto', async () => {
    const result = await controller.authorize(
      { id: 'therapist-1' } as never,
      res as unknown as Response,
    );

    expect(result).toEqual({ url: 'https://google/auth' });
    expect(res.cookie).toHaveBeenCalledWith(
      CALENDAR_OAUTH_COOKIE_NAME,
      'tok',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        maxAge: STATE_TTL_MS,
      }),
    );
  });

  it('callback pasa el valor de la cookie a verifyAndConsumeState y la descarta', async () => {
    await controller.callback(
      'code-1',
      'state-1',
      reqWithCookie(`otra=1; ${CALENDAR_OAUTH_COOKIE_NAME}=tok; x=2`),
      res as unknown as Response,
    );

    expect(oauthService.verifyAndConsumeState).toHaveBeenCalledWith(
      'state-1',
      'tok',
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      CALENDAR_OAUTH_COOKIE_NAME,
      expect.objectContaining({ sameSite: 'lax' }),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'https://app.umbral.cl/security?calendar=connected',
    );
  });

  it('callback sin cookie llega sin token, redirige a error y igual descarta la cookie', async () => {
    oauthService.verifyAndConsumeState.mockRejectedValue(
      new Error('sin cookie'),
    );

    await controller.callback(
      'code-1',
      'state-1',
      reqWithCookie(),
      res as unknown as Response,
    );

    expect(oauthService.verifyAndConsumeState).toHaveBeenCalledWith(
      'state-1',
      undefined,
    );
    expect(oauthService.exchangeCodeAndPersist).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      'https://app.umbral.cl/security?calendar=error',
    );
  });

  describe('extractCalendarOauthCookie', () => {
    it.each([
      ['sin header', undefined, undefined],
      ['otra cookie', 'umbral_session=abc', undefined],
      ['valor vacío', `${CALENDAR_OAUTH_COOKIE_NAME}=`, undefined],
      ['presente', `a=1; ${CALENDAR_OAUTH_COOKIE_NAME}=xyz`, 'xyz'],
    ])('%s', (_label, header, expected) => {
      expect(extractCalendarOauthCookie(reqWithCookie(header))).toBe(expected);
    });
  });
});
