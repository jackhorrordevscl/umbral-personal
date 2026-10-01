import {
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, tap, throwError } from 'rxjs';
import type { Request } from 'express';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../modules/audit/audit.service';
import { getResourceFromUrl } from '../utils/audit-resource.util';
import { getRequestClientIp } from '../utils/client-ip.util';
import {
  AUDIT_READ_KEY,
  type AuditReadOptions,
} from '../decorators/audit-read.decorator';
import { SKIP_AUDIT_KEY } from '../decorators/skip-audit.decorator';
import type { RequestUser } from '../decorators/current-user.decorator';

interface AuditableRequest extends Request {
  user?: RequestUser;
  body: { patientId?: string } & Record<string, unknown>;
  // Paciente al que pertenece el recurso leído; lo fija el handler cuando el
  // patientId no viaja en la URL (p. ej. descarga de un documento por id).
  auditPatientId?: string;
}

// params.id/patientId puede ser string[] en Express 5 (segmentos wildcard)
// -- se toma el primer valor si llega un array, mismo criterio que
// jwt-auth.guard.ts.
function firstIfArray(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Recursos clínicos cuyo acceso denegado (403) o a un id inexistente/ajeno
// (404) se registra como UNAUTHORIZED_ATTEMPT.
const CLINICAL_RESOURCES = new Set([
  'Patient',
  'PatientConsent',
  'Consultation',
  'Report',
  'Document',
  'SharedFile',
]);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private auditService: AuditService,
    private reflector: Reflector = new Reflector(),
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<AuditableRequest>();
    const user = request.user;

    // Solo registra si hay usuario autenticado
    if (!user) return next.handle();

    // @SkipAudit(): endpoints de sondeo que no deben generar filas.
    const skip = this.reflector.get<boolean | undefined>(
      SKIP_AUDIT_KEY,
      context.getHandler(),
    );
    if (skip) return next.handle();

    const method = request.method;
    const url = request.url;
    const ipAddress = getRequestClientIp(request);
    const userAgent = request.headers['user-agent'];

    // Determina la acción según el método HTTP
    const actionMap: Record<string, AuditAction> = {
      GET: 'VIEW',
      POST: 'CREATE',
      PATCH: 'UPDATE',
      DELETE: 'SOFT_DELETE',
    };

    const readOptions = this.reflector.get<AuditReadOptions | undefined>(
      AUDIT_READ_KEY,
      context.getHandler(),
    );
    const action = readOptions?.action ?? actionMap[method] ?? 'VIEW';
    const resource = getResourceFromUrl(url);

    return next.handle().pipe(
      tap(() => {
        // request.body recién en este punto está garantizado completo: en
        // POST /documents/upload, patientId viaja en el body (multipart,
        // parseado por el FileInterceptor del controller) en vez de en la
        // URL, y ese interceptor corre DESPUÉS de este (que es global) pero
        // ANTES de que next.handle() resuelva -- leer el body antes de acá
        // lo encontraba vacío y dejaba resourceId en 'N/A' (issue #36).
        const resourceId = this.resolveResourceId(request);

        // El handler ya corrió: auditPatientId, si lo fijó, está disponible.
        const detailParts = [`${method} ${url}`];
        if (readOptions?.detail) detailParts.push(readOptions.detail);
        if (request.auditPatientId) {
          detailParts.push(`patientId=${request.auditPatientId}`);
        }

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
            detail: detailParts.join(' '),
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
      catchError((error: unknown) => {
        // Acceso denegado o a un recurso inexistente/ajeno sobre datos
        // clínicos: queda registrado y el error original se relanza intacto.
        // El 401 no se registra acá (ya lo hace el guard JWT).
        if (
          error instanceof HttpException &&
          (error.getStatus() === 403 || error.getStatus() === 404) &&
          CLINICAL_RESOURCES.has(resource)
        ) {
          const status = error.getStatus();
          this.auditService
            .log({
              userId: user.id,
              action: 'UNAUTHORIZED_ATTEMPT',
              resource,
              resourceId: this.resolveResourceId(request),
              detail: `${method} ${url} status=${status}`,
              ipAddress,
              userAgent,
            })
            .catch((err) => {
              this.logger.error(
                `Fallo al registrar intento no autorizado: userId=${user.id} resource=${resource} status=${status} — ${err instanceof Error ? err.message : err}`,
                err instanceof Error ? err.stack : undefined,
              );
            });
        }
        return throwError(() => error);
      }),
    );
  }

  private resolveResourceId(request: AuditableRequest): string {
    return (
      firstIfArray(request.params?.id) ??
      firstIfArray(request.params?.patientId) ??
      request.body?.patientId ??
      'N/A'
    );
  }
}
