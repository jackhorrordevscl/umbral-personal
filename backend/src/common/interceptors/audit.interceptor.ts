import {
  Injectable,
  Logger,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../../modules/audit/audit.service';
import { getResourceFromUrl } from '../utils/audit-resource.util';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Solo registra si hay usuario autenticado
    if (!user) return next.handle();

    const method = request.method;
    const url = request.url;
    // T6.5 (issue #52): GET /patients/by-rut/:rut no tiene :id ni
    // :patientId -- sin este fallback, cualquier búsqueda por RUT quedaba
    // auditada con resourceId='N/A', perdiendo trazabilidad de qué RUT se
    // consultó.
    const resourceId =
      request.params?.id ??
      request.params?.patientId ??
      request.params?.rut ??
      'N/A';
    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'];

    // Determina la acción según el método HTTP
    const actionMap: Record<string, string> = {
      GET: 'VIEW',
      POST: 'CREATE',
      PATCH: 'UPDATE',
      DELETE: 'SOFT_DELETE',
    };

    const action = actionMap[method] ?? 'VIEW';
    const resource = getResourceFromUrl(url);

    // T6.5 (issue #52): si el request trae `overrideReason` (body o query),
    // se adjunta al mismo log automático de esta acción -- genérico, no
    // acoplado a la ruta de acceso excepcional en particular. Cualquier
    // otro endpoint que en el futuro necesite el mismo patrón de "acción
    // excepcional con motivo auditado" lo obtiene gratis con solo mandar
    // ese campo.
    const overrideReason: string | undefined =
      request.body?.overrideReason ?? request.query?.overrideReason;

    return next.handle().pipe(
      tap(() => {
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
            overrideReason,
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