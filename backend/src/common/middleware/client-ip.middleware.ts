import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { getClientIp } from '../utils/client-ip.util';

export function parseTrustedProxyHops(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  new Logger('ClientIpMiddleware').warn(
    `TRUSTED_PROXY_HOPS="${raw}" no es un entero positivo válido, usando el default (1).`,
  );
  return 1;
}

// Issue #301: resuelve la IP real del cliente una vez por request y la deja
// en req.clientIp, para que AuditLog.ipAddress, Session.ipAddress y el
// historial de MFA dejen de registrar la IP del proxy. No toca
// `trust proxy` de Express: req.ip sigue siendo la del par TCP.
@Injectable()
export class ClientIpMiddleware implements NestMiddleware {
  private readonly trustedProxyHops: number;

  constructor(config: ConfigService) {
    this.trustedProxyHops = parseTrustedProxyHops(
      config.get<string>('TRUSTED_PROXY_HOPS'),
    );
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    (req as Request & { clientIp?: string }).clientIp = getClientIp(
      req,
      this.trustedProxyHops,
    );
    next();
  }
}
