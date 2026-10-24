import { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PrismaExceptionFilter } from './prisma-exception.filter';
import { AllExceptionsFilter } from './all-exceptions.filter';

// Orden importa. Nest invierte la lista de filtros globales al resolverlos y usa
// el primero cuyo tipo matchea la excepción: el catch-all AllExceptionsFilter
// (@Catch() sin argumentos) se registra primero para quedar al final de la
// cadena, y PrismaExceptionFilter (específico) se registra último para
// evaluarse antes.
export function registerGlobalFilters(app: INestApplication): void {
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(
    new AllExceptionsFilter(httpAdapterHost),
    new PrismaExceptionFilter(httpAdapterHost),
  );
}
