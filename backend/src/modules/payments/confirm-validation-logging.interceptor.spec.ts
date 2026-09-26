import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { ConfirmValidationLoggingInterceptor } from './confirm-validation-logging.interceptor';

describe('ConfirmValidationLoggingInterceptor', () => {
  let interceptor: ConfirmValidationLoggingInterceptor;
  let warn: jest.SpyInstance;

  const contextWith = (body: unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ body }) }),
    }) as unknown as ExecutionContext;
  const failingWith = (err: unknown): CallHandler => ({
    handle: () => throwError(() => err),
  });

  beforeEach(() => {
    interceptor = new ConfirmValidationLoggingInterceptor();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('registra el rechazo de validación con los nombres de campo, sin valores', async () => {
    const err = new BadRequestException({
      message: ['s must be a string', 's should not be empty'],
    });

    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextWith({ token: 'secreto-token' }),
          failingWith(err),
        ),
      ),
    ).rejects.toBe(err);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String((warn.mock.calls as unknown[][])[0][0]);
    expect(line).toContain('s must be a string');
    expect(line).toContain('campos recibidos: token');
    expect(line).not.toContain('secreto-token');
  });

  it('no registra el 400 uniforme del controlador (ya lo registra el controlador)', async () => {
    const err = new BadRequestException('Firma de confirmación inválida.');

    await expect(
      lastValueFrom(interceptor.intercept(contextWith({}), failingWith(err))),
    ).rejects.toBe(err);

    expect(warn).not.toHaveBeenCalled();
  });

  it('deja pasar la respuesta exitosa sin registrar nada', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(contextWith({}), {
        handle: () => of({ received: true }),
      }),
    );

    expect(result).toEqual({ received: true });
    expect(warn).not.toHaveBeenCalled();
  });
});
