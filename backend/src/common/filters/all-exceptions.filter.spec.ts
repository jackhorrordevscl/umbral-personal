import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter';

function buildHost(overrides: Partial<any> = {}): ArgumentsHost {
  const request = { method: 'GET', url: '/api/v1/patients', ...overrides };
  const response = {};
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

type ReplyMock = jest.Mock<void, [unknown, unknown, number]>;

function buildAdapterHost(reply: ReplyMock): HttpAdapterHost {
  return { httpAdapter: { reply } } as unknown as HttpAdapterHost;
}

function buildReplyMock(): ReplyMock {
  return jest.fn<void, [unknown, unknown, number]>();
}

describe('AllExceptionsFilter', () => {
  it('preserva el status y el body de una HttpException lanzada a propósito', () => {
    const reply = buildReplyMock();
    const filter = new AllExceptionsFilter(buildAdapterHost(reply));

    filter.catch(new BadRequestException('RUT inválido'), buildHost());

    expect(reply).toHaveBeenCalledTimes(1);
    const [, body, status] = reply.mock.calls[0];
    expect(status).toBe(400);
    expect(body).toMatchObject({ message: 'RUT inválido' });
  });

  it('devuelve 500 genérico y loggea con contexto para un error no manejado', () => {
    const reply = buildReplyMock();
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const filter = new AllExceptionsFilter(buildAdapterHost(reply));

    filter.catch(
      new Error('pdfkit: fuente no encontrada'),
      buildHost({ method: 'GET', url: '/api/v1/reports/patient/abc' }),
    );

    expect(reply).toHaveBeenCalledTimes(1);
    const [, body, status] = reply.mock.calls[0];
    expect(status).toBe(500);
    // El mensaje interno del error NUNCA debe llegar al cliente.
    expect(JSON.stringify(body)).not.toContain('pdfkit');
    expect(body).toMatchObject({
      statusCode: 500,
      message: 'Internal server error',
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [logMessage] = errorSpy.mock.calls[0] as [string, string?];
    expect(logMessage).toContain('/api/v1/reports/patient/abc');
    expect(logMessage).toContain('pdfkit: fuente no encontrada');

    errorSpy.mockRestore();
  });

  it('no loggea para excepciones HTTP normales (4xx)', () => {
    const reply = buildReplyMock();
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const filter = new AllExceptionsFilter(buildAdapterHost(reply));

    filter.catch(new BadRequestException('dato inválido'), buildHost());

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('maneja un valor lanzado que no es un Error (ej. throw "algo")', () => {
    const reply = buildReplyMock();
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const filter = new AllExceptionsFilter(buildAdapterHost(reply));

    filter.catch('algo explotó', buildHost());

    const [, body, status] = reply.mock.calls[0];
    expect(status).toBe(500);
    expect(body).toMatchObject({ statusCode: 500 });
    expect(errorSpy.mock.calls[0][0]).toContain('algo explotó');

    errorSpy.mockRestore();
  });
});
