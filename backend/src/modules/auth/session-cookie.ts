import type { CookieOptions, Request, Response } from 'express';

// Issue #387 / ADR 0003: la sesión viaja en una cookie HttpOnly además del
// Bearer (que sigue válido durante la transición).
//
// Sin atributo `Domain` a propósito: la cookie queda atada al host exacto de
// la API (host-only). El dominio de producción es temporal; al cambiarlo no
// hay nada que reconfigurar, pero el frontend y la API deben seguir siendo
// same-site (mismo dominio registrable) para que SameSite=Strict la envíe.
//
// Issue #627: en producción (donde la cookie es Secure) el nombre lleva el
// prefijo `__Host-`. El navegador solo acepta ese prefijo con Secure, Path=/ y
// sin Domain, así que un subdominio hermano no puede fijar una cookie con el
// mismo nombre (cookie tossing) y hacer que se lea la suya. En desarrollo la
// cookie no es Secure (http) y se queda con el nombre sin prefijo. Sin lectura
// del nombre anterior en producción: aceptarlo reabriría el hueco; las
// sesiones previas (8 h) simplemente piden iniciar sesión otra vez.
export const SESSION_COOKIE_NAME = 'umbral_session';
export const HOST_SESSION_COOKIE_NAME = `__Host-${SESSION_COOKIE_NAME}`;

function isSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function sessionCookieName(): string {
  return isSecure() ? HOST_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME;
}

const DEFAULT_MAX_AGE_MS = 8 * 60 * 60 * 1000;

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecure(),
    path: '/',
  };
}

// La cookie debe expirar junto con el JWT: se lee `exp` del payload (ya
// firmado por nosotros, no hace falta verificarlo de nuevo para esto).
function maxAgeFromToken(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    ) as { exp?: number };
    if (typeof payload.exp === 'number') {
      return Math.max(payload.exp * 1000 - Date.now(), 0);
    }
  } catch {
    // token mal formado: se cae al valor por defecto
  }
  return DEFAULT_MAX_AGE_MS;
}

export function setSessionCookie(res: Response, accessToken: string): void {
  res.cookie(sessionCookieName(), accessToken, {
    ...baseOptions(),
    maxAge: maxAgeFromToken(accessToken),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(sessionCookieName(), baseOptions());
  // Cierra también la cookie sin prefijo que dejó una sesión anterior al
  // cambio de nombre: no se lee, pero no debe quedar viva en el navegador.
  if (isSecure()) res.clearCookie(SESSION_COOKIE_NAME, baseOptions());
}

// Extractor para passport-jwt. Parseo manual del header para no sumar
// `cookie-parser` como dependencia solo por una cookie.
export function extractSessionCookie(req: Request): string | null {
  const header = req?.headers?.cookie;
  if (!header) return null;
  const name = sessionCookieName();
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

// Solo las respuestas que emiten una sesión real llevan accessToken; el resto
// (requiresMfa, requiresPasswordChange...) no debe tocar la cookie.
export function applySessionCookie<T>(res: Response, result: T): T {
  const token = (result as { accessToken?: unknown } | null)?.accessToken;
  if (typeof token === 'string') setSessionCookie(res, token);
  return result;
}
