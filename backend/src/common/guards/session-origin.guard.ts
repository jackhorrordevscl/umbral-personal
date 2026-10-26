import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { extractSessionCookie } from '../../modules/auth/session-cookie';
import { getAllowedOrigins } from '../utils/allowed-origins.util';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Issue #487 / ADR 0003: la cookie de sesión (HttpOnly, SameSite=Strict) era
// la única defensa contra CSRF. SameSite solo separa dominios registrables: un
// subdominio hermano con contenido no controlado seguiría siendo same-site.
// Defensa en profundidad: una petición que cambia estado y viaja con la cookie
// de sesión debe venir del frontend. Se mira primero Origin (el navegador lo
// envía en todo POST/PUT/PATCH/DELETE) y, si falta, Sec-Fetch-Site. Sin cookie
// de sesión no hay credencial que abusar, y un cliente que no es navegador (sin
// ninguna de las dos cabeceras) sigue pasando.
@Injectable()
export class SessionOriginGuard implements CanActivate {
  private readonly logger = new Logger(SessionOriginGuard.name);
  private readonly allowedOrigins: Set<string>;

  constructor(config: ConfigService) {
    this.allowedOrigins = new Set(
      getAllowedOrigins({
        NODE_ENV: config.get<string>('NODE_ENV'),
        LAN_DEV_URL: config.get<string>('LAN_DEV_URL'),
        FRONTEND_URL: config.get<string>('FRONTEND_URL'),
      }).map(normalizeOrigin),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!UNSAFE_METHODS.has(req.method)) return true;
    if (!extractSessionCookie(req)) return true;

    const origin = req.headers.origin;
    if (origin) {
      if (this.allowedOrigins.has(normalizeOrigin(origin))) return true;
      this.reject(req.method, 'origin');
    }

    const site = req.headers['sec-fetch-site'];
    if (site === 'cross-site' || site === 'same-site') {
      this.reject(req.method, 'sec-fetch-site');
    }
    return true;
  }

  private reject(method: string, cause: string): never {
    this.logger.warn(
      `Petición ${method} con cookie de sesión rechazada por ${cause}`,
    );
    throw new ForbiddenException('Origen no permitido');
  }
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}
