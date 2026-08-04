import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from '../../modules/audit/audit.service';

function buildContext(overrides: Partial<any> = {}): ExecutionContext {
  const request = {
    user: { id: 'user-1' },
    method: 'GET',
    url: '/api/v1/patients/abc',
    params: { id: 'abc' },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest' },
    ...overrides,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildCallHandler(): CallHandler {
  return { handle: () => of({ ok: true }) };
}

describe('AuditInterceptor', () => {
  it('reporta el fallo de forma visible (Logger.error) en vez de tragárselo en silencio', (done) => {
    // El mock se referencia via esta variable, no via
    // failingAuditService.log, para no disparar @typescript-eslint/
    // unbound-method (el cast a AuditService hace que .log se vea como un
    // método de instancia sin bindear).
    const logMock = jest.fn().mockRejectedValue(new Error('DB no disponible'));
    const failingAuditService = { log: logMock } as unknown as AuditService;

    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const interceptor = new AuditInterceptor(failingAuditService);

    interceptor.intercept(buildContext(), buildCallHandler()).subscribe(() => {
      // El request principal se resuelve igual (fail-open): el fallo de
      // auditoría no debe romper la respuesta al cliente.
      setImmediate(() => {
        expect(logMock).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][0]).toContain(
          'Fallo al registrar auditoría',
        );
        expect(errorSpy.mock.calls[0][0]).toContain('DB no disponible');
        errorSpy.mockRestore();
        done();
      });
    });
  });

  it('no llama a auditService.log si no hay usuario autenticado en el request', (done) => {
    const logMock = jest.fn();
    const auditService = { log: logMock } as unknown as AuditService;
    const interceptor = new AuditInterceptor(auditService);

    interceptor
      .intercept(buildContext({ user: undefined }), buildCallHandler())
      .subscribe(() => {
        expect(logMock).not.toHaveBeenCalled();
        done();
      });
  });
});
