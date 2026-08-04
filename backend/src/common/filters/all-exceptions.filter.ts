import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

// Sin esto, cualquier error que no sea un Prisma.PrismaClientKnownRequestError
// ni una HttpException lanzada a propósito (ej. una excepción de pdfkit al
// generar un reporte, de resend al enviar un email, o de multer al procesar
// un upload) caía al filtro por defecto de Nest -- responde bien al cliente
// (no filtra información), pero no queda loggeado con contexto en ningún
// lado, así que una falla real ahí no deja rastro más allá del 500 genérico.
// Registrado DESPUÉS de PrismaExceptionFilter en main.ts (@Catch() sin
// argumentos actúa como catch-all, así que tiene que ser el último: Nest
// usa el primer filtro registrado cuyo tipo matchea la excepción).
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ method?: string; url?: string }>();

    const isHttpException = exception instanceof HttpException;
    const status: number = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // Las HttpException lanzadas a propósito (ValidationPipe, guards,
    // NotFoundException de un service, etc.) ya traen su propio body seguro
    // -- solo se reemplaza por el body genérico de Nest cuando es un error
    // realmente no manejado, para no exponer stack traces ni mensajes
    // internos al cliente.
    const responseBody = isHttpException
      ? exception.getResponse()
      : { statusCode: status, message: 'Internal server error' };

    if (status === (HttpStatus.INTERNAL_SERVER_ERROR as number)) {
      const message =
        exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `${request.method ?? '?'} ${request.url ?? '?'} -> 500: ${message}`,
        stack,
      );
    }

    httpAdapter.reply(ctx.getResponse(), responseBody, status);
  }
}
