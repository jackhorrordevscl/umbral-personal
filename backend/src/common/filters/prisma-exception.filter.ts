import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HttpAdapterHost } from '@nestjs/core';

// Normaliza los errores más comunes de Prisma a excepciones HTTP de Nest en
// toda la app, para no depender de que cada service valide a mano los
// conflictos de unicidad/FK antes de escribir (issue #29).
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    const mapped = this.mapToHttpException(exception);
    const body = mapped.getResponse();

    httpAdapter.reply(ctx.getResponse(), body, mapped.getStatus());
  }

  private mapToHttpException(exception: Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002': {
        const target = (exception.meta?.target as string[] | undefined)?.join(
          ', ',
        );
        return new ConflictException(
          target
            ? `Ya existe un registro con ese ${target}`
            : 'Registro duplicado',
        );
      }
      case 'P2025':
        return new NotFoundException('Registro no encontrado');
      case 'P2003':
        return new ConflictException(
          'La operación viola una referencia existente',
        );
      default:
        // Código de Prisma no mapeado explícitamente: no asumir que es un
        // conflicto de datos, dejarlo como error de servidor genérico.
        return new InternalServerErrorException(
          'Error al procesar la operación en la base de datos',
        );
    }
  }
}
