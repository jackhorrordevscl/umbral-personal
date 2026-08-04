import {
  Injectable,
  Logger,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../modules/audit/audit.service';
import { getResourceFromUrl } from '../utils/audit-resource.util';
import type { RequestUser } from '../decorators/current-user.decorator';

interface AuditableRequest extends Request {
  user?: RequestUser;
  body: { patientId?: string } & Record<string, unknown>;
}

// params.id/patientId puede ser string[] en Express 5 (segmentos wildcard)
// -- se toma el primer valor si llega un array, mismo criterio que
// jwt-auth.guard.ts.
function firstIfArray(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<AuditableRequest>();
    const user = request.user;

    // Solo registra si hay usuario autenticado
    if (!user) return next.handle();

    const method = request.method;
    const url = request.url;
    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'];

    // Determina la acción según el método HTTP
    const actionMap: Record<string, AuditAction> = {
      GET: 'VIEW',
      POST: 'CREATE',
      PATCH: 'UPDATE',
      DELETE: 'SOFT_DELETE',
    };

    const action = actionMap[method] ?? 'VIEW';
    const resource = getResourceFromUrl(url);

    return next.handle().pipe(
      tap(() => {
        // request.body recién en este punto está garantizado completo: en
        // POST /documents/upload, patientId viaja en el body (multipart,
        // parseado por el FileInterceptor del controller) en vez de en la
        // URL, y ese interceptor corre DESPUÉS de este (que es global) pero
        // ANTES de que next.handle() resuelva -- leer el body antes de acá
        // lo encontraba vacío y dejaba resourceId en 'N/A' (issue #36).
        const resourceId =
          firstIfArray(request.params?.id) ??
          firstIfArray(request.params?.patientId) ??
          request.body?.patientId ??
          'N/A';

        // Registra después de que la respuesta fue exitosa. Si falla, el
        // request principal no se ve afectado (fail-open: la atención al
        // paciente no depende de la disponibilidad del log), pero el fallo
        // se reporta de forma alta y clara — nunca desaparece en silencio.
        this.auditService
          .log({
            userId: user.id,
            action,
            resource,
            resourceId,
            detail: `${method} ${url}`,
            ipAddress,
            userAgent,
          })
          .catch((err) => {
            this.logger.error(
              `Fallo al registrar auditoría: userId=${user.id} action=${action} resource=${resource} resourceId=${resourceId} — ${err instanceof Error ? err.message : err}`,
              err instanceof Error ? err.stack : undefined,
            );
          });
      }),
    );
  }
}
