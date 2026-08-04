import { ExecutionContext, Logger } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuditService } from '../../modules/audit/audit.service';

function buildContext(): ExecutionContext {
  const request = {
    method: 'GET',
    url: '/api/v1/patients',
    params: {},
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest' },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('reporta el fallo de auditoría de un intento no autorizado de forma visible', async () => {
    // El mock se referencia via esta variable, no via
    // failingAuditService.log, para no disparar @typescript-eslint/
    // unbound-method (el cast a AuditService hace que .log se vea como un
    // método de instancia sin bindear).
    const logMock = jest.fn().mockRejectedValue(new Error('DB no disponible'));
    const failingAuditService = { log: logMock } as unknown as AuditService;

    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const guard = new JwtAuthGuard(failingAuditService);

    expect(() => {
      guard.handleRequest(null, false, null, buildContext());
    }).toThrow();

    // handleRequest dispara el log de forma fire-and-forget antes de tirar
    // la excepción de Passport; esperamos el microtask para que el .catch corra.
    await new Promise((resolve) => setImmediate(resolve));

    expect(logMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain(
      'Fallo al registrar intento no autorizado',
    );
    expect(errorSpy.mock.calls[0][0]).toContain('DB no disponible');

    errorSpy.mockRestore();
  });

  it('reporta el fallo de auditoría cuando el rechazo no es un Error (rama no-Error del ternario)', async () => {
    const failingAuditService = {
      log: jest.fn().mockRejectedValue('fallo-string'),
    } as unknown as AuditService;

    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const guard = new JwtAuthGuard(failingAuditService);

    expect(() => {
      guard.handleRequest(null, false, null, buildContext());
    }).toThrow();

    await new Promise((resolve) => setImmediate(resolve));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('fallo-string');
    expect(errorSpy.mock.calls[0][1]).toBeUndefined();

    errorSpy.mockRestore();
  });

  it('no registra auditoría y devuelve el usuario en el camino feliz (err=null, user truthy)', () => {
    const logMock = jest.fn();
    const auditService = { log: logMock } as unknown as AuditService;

    const guard = new JwtAuthGuard(auditService);
    const user = { id: 'user-1', role: 'STAFF' };

    const result = guard.handleRequest<typeof user>(
      null,
      user,
      null,
      buildContext(),
    );

    expect(result).toBe(user);
    expect(logMock).not.toHaveBeenCalled();
  });
});
