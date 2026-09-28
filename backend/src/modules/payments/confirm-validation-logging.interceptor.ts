import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { catchError, throwError } from 'rxjs';

// El ValidationPipe global rechaza el body de POST /payments/confirm (DTO
// con `token` y `s`, forbidNonWhitelisted) ANTES de que corra el
// controlador, y Nest no registra las 4xx: si Flow enviara un body distinto
// al esperado, el rechazo quedaría mudo. Los interceptores corren antes que
// los pipes, así que este ve ese 400 y deja constancia de qué campos llegaron.
// Solo registra nombres de campo, nunca valores (el token y la firma no van
// al log).
@Injectable()
export class ConfirmValidationLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(
    ConfirmValidationLoggingInterceptor.name,
  );

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (err instanceof BadRequestException) {
          const response = err.getResponse() as { message?: unknown };
          // Validación de DTO => message es un arreglo; el 400 uniforme del
          // controlador (firma/token/cuenta) es un string y ya se registra allá.
          if (Array.isArray(response?.message)) {
            const body = context
              .switchToHttp()
              .getRequest<{ body?: unknown }>().body;
            const fields =
              body && typeof body === 'object' ? Object.keys(body) : [];
            this.logger.warn(
              `Confirmación de Flow rechazada por validación del body: ${response.message.join('; ')} (campos recibidos: ${fields.join(', ') || 'ninguno'}).`,
            );
          }
        }
        return throwError(() => err);
      }),
    );
  }
}
