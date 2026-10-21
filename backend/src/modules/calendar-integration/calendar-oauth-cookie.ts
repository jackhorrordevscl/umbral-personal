import type { CookieOptions, Request, Response } from 'express';
import { STATE_TTL_MS } from './calendar-integration.constants';

// Issue #497: el `state` del OAuth de Google Calendar va atado al navegador que
// inició el flujo. POST /authorize deja esta cookie con un secreto aleatorio
// (cuyo hash viaja dentro del `state` firmado) y GET /callback la exige. Quien
// obtenga un `state` por una URL, un log o un referrer no tiene la cookie y no
// puede completar el flujo con su propio código de Google.
//
// SameSite=Lax y no Strict como la sesión (session-cookie.ts): el callback es
// una navegación de primer nivel que vuelve desde accounts.google.com, y
// Strict no enviaría la cookie en esa navegación cross-site.
export const CALENDAR_OAUTH_COOKIE_NAME = 'umbral_calendar_oauth';

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

export function setCalendarOauthCookie(res: Response, bindingToken: string) {
  res.cookie(CALENDAR_OAUTH_COOKIE_NAME, bindingToken, {
    ...baseOptions(),
    maxAge: STATE_TTL_MS,
  });
}

export function clearCalendarOauthCookie(res: Response): void {
  res.clearCookie(CALENDAR_OAUTH_COOKIE_NAME, baseOptions());
}

// Parseo manual del header, igual que extractSessionCookie, para no sumar
// `cookie-parser` por una cookie.
export function extractCalendarOauthCookie(req: Request): string | undefined {
  const header = req?.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== CALENDAR_OAUTH_COOKIE_NAME) continue;
    const value = part.slice(index + 1).trim();
    return value || undefined;
  }
  return undefined;
}
