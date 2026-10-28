import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { from, Observable, switchMap } from 'rxjs';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';

export const SUBSCRIPTION_REQUIRED_CODE = 'SUBSCRIPTION_REQUIRED';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Escrituras que una cuenta en solo lectura SÍ puede hacer (issue #611). Es una
// lista de permitidas: toda escritura que no esté acá queda bloqueada, así una
// función nueva nace bloqueada por defecto. Las lecturas (GET) no se tocan: ver
// fichas y sesiones y exportar a PDF son siempre posibles.
//
// El patrón es la ruta de Express sin el prefijo global (req.route.path), por
// lo que usa los nombres de parámetro del controlador.
const ALLOWED_WRITES: ReadonlyArray<{ method?: string; pattern: RegExp }> = [
  // Contraseña, MFA, cierre de sesión.
  { pattern: /^\/auth\// },
  // Pantalla de pago.
  { method: 'POST', pattern: /^\/billing\/checkout$/ },
  // Supresión de un paciente y registro o revocación de consentimientos.
  { method: 'DELETE', pattern: /^\/patients\/:id$/ },
  { method: 'POST', pattern: /^\/patients\/:id\/consents$/ },
  { method: 'POST', pattern: /^\/patients\/consents\/bulk-declare$/ },
  { method: 'POST', pattern: /^\/patients\/:patientId\/assents$/ },
  // Entrega de un informe de alta ya emitido.
  { method: 'POST', pattern: /^\/discharges\/:id\/deliveries$/ },
  // Marcar notificaciones como leídas y datos de la cuenta (contraseña).
  { method: 'PATCH', pattern: /^\/notifications\/(read-all|:id\/read)$/ },
  { method: 'PATCH', pattern: /^\/profile$/ },
];

export function isWriteAllowedInReadOnly(method: string, routePath: string) {
  const path = routePath.replace(/^\/api\/v\d+/, '');
  return ALLOWED_WRITES.some(
    (rule) =>
      (rule.method === undefined || rule.method === method) &&
      rule.pattern.test(path),
  );
}

// Issue #611: cuenta sin suscripción vigente (pasada la gracia) queda en solo
// lectura. Es un interceptor global (corre DESPUÉS de los guards, así que
// request.user ya está resuelto por JwtAuthGuard). Las rutas públicas no tienen
// usuario y no se tocan. Solo las escrituras consultan la base: las lecturas
// pasan sin costo.
@Injectable()
export class SubscriptionAccessInterceptor implements NestInterceptor {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http' || !this.subscriptions.isEnforced()) {
      return next.handle();
    }
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: RequestUser }>();
    const userId = request.user?.id;
    if (
      !userId ||
      SAFE_METHODS.has(request.method) ||
      isWriteAllowedInReadOnly(
        request.method,
        (request.route as { path?: string } | undefined)?.path ?? '',
      )
    ) {
      return next.handle();
    }

    return from(this.subscriptions.isWriteBlocked(userId)).pipe(
      switchMap((blocked) => {
        if (!blocked) return next.handle();
        throw new HttpException(
          {
            statusCode: HttpStatus.PAYMENT_REQUIRED,
            code: SUBSCRIPTION_REQUIRED_CODE,
            message:
              'Tu suscripción venció. Puedes consultar tu información, pero para seguir registrando cambios necesitas renovarla.',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }),
    );
  }
}
