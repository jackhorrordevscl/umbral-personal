import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  Observable,
  OperatorFunction,
  catchError,
  mergeMap,
  tap,
  throwError,
} from 'rxjs';
import type { Request } from 'express';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../modules/audit/audit.service';
import { getResourceFromUrl } from '../utils/audit-resource.util';
import { getRequestClientIp } from '../utils/client-ip.util';
import {
  AUDIT_READ_KEY,
  type AuditReadOptions,
} from '../decorators/audit-read.decorator';
import {
  SKIP_AUDIT_KEY,
  type SkipAuditOptions,
} from '../decorators/skip-audit.decorator';
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
  'Discharge',
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

    // @SkipAudit(): endpoints de sondeo que no deben generar filas. Con
    // keepDenied, el acceso denegado sí se registra (ver SkipAuditOptions).
    const skip = this.reflector.get<SkipAuditOptions | undefined>(
      SKIP_AUDIT_KEY,
      context.getHandler(),
    );
    if (skip) {
      if (!skip.keepDenied) return next.handle();
      return next.handle().pipe(
        catchError((error: unknown) => {
          this.recordDenied(error, request, user);
          return throwError(() => error);
        }),
      );
    }

    const method = request.method;
    // Solo la ruta: el query string puede traer datos personales (ej. el
    // nombre o RUT de GET /patients?search=) que no deben quedar en el log de
    // auditoría, y su texto tampoco debe influir en la clasificación del
    // recurso.
    const url = request.url.split('?')[0];
    const ipAddress = getRequestClientIp(request);
    const userAgent = request.headers['user-agent'];

    // Determina la acción según el método HTTP
    const actionMap: Record<string, AuditAction> = {
      GET: 'VIEW',
      POST: 'CREATE',
      PUT: 'UPDATE',
      PATCH: 'UPDATE',
      DELETE: 'SOFT_DELETE',
    };

    const readOptions = this.reflector.get<AuditReadOptions | undefined>(
      AUDIT_READ_KEY,
      context.getHandler(),
    );
    const action = readOptions?.action ?? actionMap[method] ?? 'VIEW';
    const resource = getResourceFromUrl(url);

    // Escribe la fila de la lectura exitosa. Corre cuando el handler ya
    // resolvió: auditPatientId, si lo fijó, está disponible.
    const logSuccess = (): {
      resourceId: string;
      written: Promise<unknown>;
    } => {
      // request.body recién en este punto está garantizado completo: en
      // POST /documents/upload, patientId viaja en el body (multipart,
      // parseado por el FileInterceptor del controller) en vez de en la
      // URL, y ese interceptor corre DESPUÉS de este (que es global) pero
      // ANTES de que next.handle() resuelva -- leer el body antes de acá
      // lo encontraba vacío y dejaba resourceId en 'N/A' (issue #36).
      const resourceId = this.resolveResourceId(request);

      const detailParts = [`${method} ${url}`];
      if (readOptions?.detail) detailParts.push(readOptions.detail);
      if (request.auditPatientId) {
        detailParts.push(`patientId=${request.auditPatientId}`);
      }

      const written = this.auditService.log({
        userId: user.id,
        action,
        resource,
        resourceId,
        detail: detailParts.join(' '),
        ipAddress,
        userAgent,
      });
      return { resourceId, written };
    };

    const reportFailure = (resourceId: string, err: unknown) => {
      this.logger.error(
        `Fallo al registrar auditoría: userId=${user.id} action=${action} resource=${resource} resourceId=${resourceId} — ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    };

    // failClosed: la respuesta no sale hasta que la fila esté escrita; si el
    // insert falla, el request responde 500 y el dato nunca se entrega.
    const recordSuccess: OperatorFunction<unknown, unknown> =
      readOptions?.failClosed
        ? mergeMap(async (value: unknown) => {
            const { resourceId, written } = logSuccess();
            try {
              await written;
            } catch (err) {
              reportFailure(resourceId, err);
              throw new InternalServerErrorException(
                'No se pudo registrar la auditoría de esta operación',
              );
            }
            return value;
          })
        : // Registra después de que la respuesta fue exitosa. Si falla, el
          // request principal no se ve afectado (fail-open: la atención al
          // paciente no depende de la disponibilidad del log), pero el fallo
          // se reporta de forma alta y clara — nunca desaparece en silencio.
          tap(() => {
            const { resourceId, written } = logSuccess();
            written.catch((err) => reportFailure(resourceId, err));
          });

    return next.handle().pipe(
      recordSuccess,
      catchError((error: unknown) => {
        this.recordDenied(error, request, user);
        return throwError(() => error);
      }),
    );
  }

  // Acceso denegado o a un recurso inexistente/ajeno sobre datos clínicos:
  // queda registrado y el llamador relanza el error original intacto. El 401 no
  // se registra acá (ya lo hace el guard JWT).
  private recordDenied(
    error: unknown,
    request: AuditableRequest,
    user: RequestUser,
  ): void {
    if (
      !(error instanceof HttpException) ||
      (error.getStatus() !== 403 && error.getStatus() !== 404)
    ) {
      return;
    }
    // Solo la ruta, por la misma razón que en intercept().
    const url = request.url.split('?')[0];
    const resource = getResourceFromUrl(url);
    if (!CLINICAL_RESOURCES.has(resource)) return;

    const status = error.getStatus();
    this.auditService
      .log({
        userId: user.id,
        action: 'UNAUTHORIZED_ATTEMPT',
        resource,
        resourceId: this.resolveResourceId(request),
        detail: `${request.method} ${url} status=${status}`,
        ipAddress: getRequestClientIp(request),
        userAgent: request.headers['user-agent'],
      })
      .catch((err) => {
        this.logger.error(
          `Fallo al registrar intento no autorizado: userId=${user.id} resource=${resource} status=${status} — ${err instanceof Error ? err.message : err}`,
          err instanceof Error ? err.stack : undefined,
        );
      });
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
