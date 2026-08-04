import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { AuditService } from '../../modules/audit/audit.service';
import { getResourceFromUrl } from '../utils/audit-resource.util';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private auditService: AuditService) {
    super();
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
      // params puede tener valores string[] (segmentos wildcard de Express
      // 5) -- el resto del código (audit.interceptor.ts) asume string, así
      // que se toma el primer valor si llega un array.
      const paramId = request.params?.id;
      const paramPatientId = request.params?.patientId;
      const resourceId =
        (Array.isArray(paramId) ? paramId[0] : paramId) ??
        (Array.isArray(paramPatientId) ? paramPatientId[0] : paramPatientId) ??
        'N/A';

      this.auditService
        .log({
          action: 'UNAUTHORIZED_ATTEMPT',
          resource: getResourceFromUrl(request.url),
          resourceId,
          detail: `${request.method} ${request.url}`,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        })
        .catch((logErr) => {
          this.logger.error(
            `Fallo al registrar intento no autorizado: ${request.method} ${request.url} — ${logErr instanceof Error ? logErr.message : logErr}`,
            logErr instanceof Error ? logErr.stack : undefined,
          );
        });
    }

    return super.handleRequest(err, user, info, context, status);
  }
}
