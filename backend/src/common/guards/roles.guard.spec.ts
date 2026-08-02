import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function buildContext(user: { role: string } | undefined): ExecutionContext {
  const handler = () => undefined;
  class Controller {}

  return {
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('permite el acceso cuando el handler no tiene metadata de roles', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    const result = guard.canActivate(buildContext(undefined));

    expect(result).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('roles', [
      expect.any(Function),
      expect.any(Function),
    ]);
  });

  it('permite el acceso cuando el rol del usuario está en la lista requerida', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN', 'SUPERVISOR']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    const result = guard.canActivate(buildContext({ role: 'ADMIN' }));

    expect(result).toBe(true);
  });

  it('deniega el acceso cuando el rol del usuario NO está en la lista requerida', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN', 'SUPERVISOR']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    const result = guard.canActivate(buildContext({ role: 'STAFF' }));

    expect(result).toBe(false);
  });
});
