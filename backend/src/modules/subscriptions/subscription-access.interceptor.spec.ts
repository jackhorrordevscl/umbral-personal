import { ExecutionContext, HttpException } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import {
  SUBSCRIPTION_REQUIRED_CODE,
  SubscriptionAccessInterceptor,
  isWriteAllowedInReadOnly,
} from './subscription-access.interceptor';
import { SubscriptionsService } from './subscriptions.service';

describe('isWriteAllowedInReadOnly', () => {
  it.each([
    ['POST', '/api/v1/auth/password/change'],
    ['POST', '/api/v1/auth/logout'],
    ['POST', '/api/v1/auth/mfa/enable'],
    ['POST', '/api/v1/billing/checkout'],
    ['DELETE', '/api/v1/patients/:id'],
    ['POST', '/api/v1/patients/:id/consents'],
    ['POST', '/api/v1/patients/consents/bulk-declare'],
    ['POST', '/api/v1/patients/:patientId/assents'],
    ['POST', '/api/v1/discharges/:id/deliveries'],
    ['PATCH', '/api/v1/notifications/read-all'],
    ['PATCH', '/api/v1/notifications/:id/read'],
    ['PATCH', '/api/v1/profile'],
  ])('permite %s %s', (method, path) => {
    expect(isWriteAllowedInReadOnly(method, path)).toBe(true);
  });

  it.each([
    ['POST', '/api/v1/patients'],
    ['PATCH', '/api/v1/patients/:id'],
    ['POST', '/api/v1/consultations'],
    ['PATCH', '/api/v1/consultations/:id/correct'],
    ['POST', '/api/v1/discharges/:id/issue'],
    ['POST', '/api/v1/patients/:patientId/discharges'],
    ['PUT', '/api/v1/availability/schedule'],
    ['POST', '/api/v1/calendar-integration/authorize'],
    ['POST', '/api/v1/payments/:groupId/retry-charge'],
    ['PATCH', '/api/v1/payments/:groupId'],
    ['POST', '/api/v1/documents/upload'],
    ['POST', '/api/v1/shared-files/upload'],
    ['POST', '/api/v1/profile/avatar'],
    // Mismo ruta que una permitida, otro método.
    ['PATCH', '/api/v1/billing/checkout'],
    ['POST', '/api/v1/patients/:id'],
    // Una función nueva nace bloqueada.
    ['POST', '/api/v1/funcion-nueva'],
    // Sin ruta resuelta no se permite nada.
    ['POST', ''],
  ])('bloquea %s %s', (method, path) => {
    expect(isWriteAllowedInReadOnly(method, path)).toBe(false);
  });
});

describe('SubscriptionAccessInterceptor', () => {
  let subscriptions: { isEnforced: jest.Mock; isWriteBlocked: jest.Mock };
  let interceptor: SubscriptionAccessInterceptor;
  const handler = { handle: jest.fn(() => of('ok')) };

  const contextFor = (
    request: Record<string, unknown>,
    type = 'http',
  ): ExecutionContext =>
    ({
      getType: () => type,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const write = {
    method: 'POST',
    route: { path: '/api/v1/patients' },
    user: { id: 'u1' },
  };

  beforeEach(() => {
    handler.handle.mockClear();
    subscriptions = {
      isEnforced: jest.fn().mockReturnValue(true),
      isWriteBlocked: jest.fn().mockResolvedValue(false),
    };
    interceptor = new SubscriptionAccessInterceptor(
      subscriptions as unknown as SubscriptionsService,
    );
  });

  it('con el interruptor apagado no consulta nada', async () => {
    subscriptions.isEnforced.mockReturnValue(false);

    await firstValueFrom(interceptor.intercept(contextFor(write), handler));

    expect(subscriptions.isWriteBlocked).not.toHaveBeenCalled();
    expect(handler.handle).toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'las lecturas (%s) pasan sin consultar la base',
    async (method) => {
      await firstValueFrom(
        interceptor.intercept(contextFor({ ...write, method }), handler),
      );

      expect(subscriptions.isWriteBlocked).not.toHaveBeenCalled();
      expect(handler.handle).toHaveBeenCalled();
    },
  );

  it('una ruta pública (sin usuario) no se toca', async () => {
    await firstValueFrom(
      interceptor.intercept(contextFor({ ...write, user: undefined }), handler),
    );

    expect(subscriptions.isWriteBlocked).not.toHaveBeenCalled();
    expect(handler.handle).toHaveBeenCalled();
  });

  it('una escritura permitida pasa aunque la cuenta esté en solo lectura', async () => {
    subscriptions.isWriteBlocked.mockResolvedValue(true);

    await firstValueFrom(
      interceptor.intercept(
        contextFor({
          ...write,
          route: { path: '/api/v1/auth/password/change' },
        }),
        handler,
      ),
    );

    expect(subscriptions.isWriteBlocked).not.toHaveBeenCalled();
    expect(handler.handle).toHaveBeenCalled();
  });

  it('una cuenta con acceso puede escribir', async () => {
    await firstValueFrom(interceptor.intercept(contextFor(write), handler));

    expect(subscriptions.isWriteBlocked).toHaveBeenCalledWith('u1');
    expect(handler.handle).toHaveBeenCalled();
  });

  it('una cuenta en solo lectura recibe 402 con código estable y el handler no corre', async () => {
    subscriptions.isWriteBlocked.mockResolvedValue(true);

    const error = await firstValueFrom(
      interceptor.intercept(contextFor(write), handler),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(402);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: SUBSCRIPTION_REQUIRED_CODE,
    });
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('un contexto que no es HTTP pasa sin tocarse', async () => {
    await firstValueFrom(
      interceptor.intercept(contextFor(write, 'rpc'), handler),
    );

    expect(subscriptions.isWriteBlocked).not.toHaveBeenCalled();
    expect(handler.handle).toHaveBeenCalled();
  });
});
