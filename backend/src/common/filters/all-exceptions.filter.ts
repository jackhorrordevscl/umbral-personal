import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import * as Sentry from '@sentry/node';

// body-parser (y otros middlewares de Express) rechazan con errores de
// http-errors, que no son HttpException: un body demasiado grande (413) o un
// charset no soportado (415) salían como 500 y se enviaban a Sentry. Solo se
// aceptan 4xx con `expose: true`, que http-errors reserva para mensajes que
// son seguros de mostrar al cliente.
function getExposedClientError(
  exception: unknown,
): { status: number; message: string } | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const { status, expose, message } = exception as {
    status?: unknown;
    expose?: unknown;
    message?: unknown;
  };
  if (
    expose !== true ||
    typeof status !== 'number' ||
    status < 400 ||
    status > 499 ||
    typeof message !== 'string'
  ) {
    return null;
  }
  return { status, message };
}

// Sin esto, cualquier error que no sea un Prisma.PrismaClientKnownRequestError
// ni una HttpException lanzada a propósito (ej. una excepción de pdfkit al
// generar un reporte, de resend al enviar un email, o de multer al procesar
// un upload) caía al filtro por defecto de Nest -- responde bien al cliente
// (no filtra información), pero no queda loggeado con contexto en ningún
// lado, así que una falla real ahí no deja rastro más allá del 500 genérico.
// Se registra ANTES que PrismaExceptionFilter en registerGlobalFilters
// (@Catch() sin argumentos actúa como catch-all, así que tiene que quedar
// último en la cadena: Nest invierte la lista de filtros globales al
// resolverlos).
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ method?: string; url?: string }>();

    const isHttpException = exception instanceof HttpException;
    const clientError = isHttpException
      ? null
      : getExposedClientError(exception);
    const status: number = isHttpException
      ? exception.getStatus()
      : (clientError?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);

    // Las HttpException lanzadas a propósito (ValidationPipe, guards,
    // NotFoundException de un service, etc.) ya traen su propio body seguro
    // -- solo se reemplaza por el body genérico de Nest cuando es un error
    // realmente no manejado, para no exponer stack traces ni mensajes
    // internos al cliente.
    const responseBody = isHttpException
      ? exception.getResponse()
      : clientError
        ? { statusCode: status, message: clientError.message }
        : { statusCode: status, message: 'Internal server error' };

    if (status === (HttpStatus.INTERNAL_SERVER_ERROR as number)) {
      const message =
        exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;
      // El query string puede traer PII o tokens (búsquedas por nombre o RUT,
      // enlaces con token), así que se loggea solo el path.
      const path = request.url?.split('?')[0] ?? '?';
      this.logger.error(
        `${request.method ?? '?'} ${path} -> 500: ${message}`,
        stack,
      );
      // Issue #191: no-op when Sentry was not initialised (no SENTRY_DSN).
      Sentry.captureException(exception);
    }

    httpAdapter.reply(ctx.getResponse(), responseBody, status);
  }
}
