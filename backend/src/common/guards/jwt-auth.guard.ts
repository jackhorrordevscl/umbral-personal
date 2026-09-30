import { ExecutionContext, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { AuditService } from '../../modules/audit/audit.service';
import { getResourceFromUrl } from '../utils/audit-resource.util';
import { getRequestClientIp } from '../utils/client-ip.util';
import {
  parsePositiveIntEnv,
  sharedUnauthorizedAttemptLimiter,
  UNAUTHORIZED_AUDIT_DEFAULT_LIMIT,
  UNAUTHORIZED_AUDIT_DEFAULT_WINDOW_MS,
} from '../utils/unauthorized-attempt-limiter.util';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly auditLimit: number;
  private readonly auditWindowMs: number;

  constructor(
    private auditService: AuditService,
    @Optional() config?: ConfigService,
  ) {
    super();
    this.auditLimit = parsePositiveIntEnv(
      config?.get<string>('UNAUTHORIZED_AUDIT_LIMIT'),
      UNAUTHORIZED_AUDIT_DEFAULT_LIMIT,
    );
    this.auditWindowMs = parsePositiveIntEnv(
      config?.get<string>('UNAUTHORIZED_AUDIT_WINDOW_MS'),
      UNAUTHORIZED_AUDIT_DEFAULT_WINDOW_MS,
    );
  }

  handleRequest<TUser = any>(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
    status?: any,
  ): TUser {
    if (err || !user) {
      const request: Request = context.switchToHttp().getRequest();
      const clientIp = getRequestClientIp(request);
      // Issue #301: cada request sin token escribía una fila con la URL
      // completa. Se acota por IP (un flood no hace crecer AuditLog sin tope)
      // y solo se guarda el path, sin query string (puede traer tokens u
      // otros datos sensibles). El rechazo 401 no cambia.
      if (
        sharedUnauthorizedAttemptLimiter.allow(
          clientIp,
          this.auditLimit,
          this.auditWindowMs,
        )
      ) {
        this.logUnauthorizedAttempt(request, clientIp);
      }
    }

    return super.handleRequest(err, user, info, context, status);
  }

  private logUnauthorizedAttempt(request: Request, clientIp: string): void {
    // params puede tener valores string[] (segmentos wildcard de Express
    // 5) -- el resto del código (audit.interceptor.ts) asume string, así
    // que se toma el primer valor si llega un array.
    const paramId = request.params?.id;
    const paramPatientId = request.params?.patientId;
    const resourceId =
      (Array.isArray(paramId) ? paramId[0] : paramId) ??
      (Array.isArray(paramPatientId) ? paramPatientId[0] : paramPatientId) ??
      'N/A';
    const path = request.url.split('?')[0];

    this.auditService
      .log({
        action: 'UNAUTHORIZED_ATTEMPT',
        resource: getResourceFromUrl(path),
        resourceId,
        detail: `${request.method} ${path}`,
        ipAddress: clientIp,
        userAgent: request.headers['user-agent'],
      })
      .catch((logErr) => {
        this.logger.error(
          `Fallo al registrar intento no autorizado: ${request.method} ${path} — ${logErr instanceof Error ? logErr.message : logErr}`,
          logErr instanceof Error ? logErr.stack : undefined,
        );
      });
  }
}
