import {
  BadRequestException,
  CallHandler,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  UnauthorizedException,
  Param,
  Req,
  Res,
  type INestApplication,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';
import request from 'supertest';
import { of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from '../../modules/audit/audit.service';
import { AuditRead } from '../decorators/audit-read.decorator';
import { SkipAudit } from '../decorators/skip-audit.decorator';

function buildContext(
  overrides: Partial<any> = {},
  handler: () => void = () => undefined,
): ExecutionContext {
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
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

function buildCallHandler(): CallHandler {
  return { handle: () => of({ ok: true }) };
}

// Los metadatos del decorador viven en la función del prototipo; se devuelve
// sin bindear a propósito para que el Reflector la encuentre.
function handlerOf(ctrl: { prototype: { handler: () => void } }): () => void {
  return ctrl.prototype.handler;
}

function firstLogEntry(logMock: jest.Mock): Record<string, unknown> {
  const calls = logMock.mock.calls as Array<[Record<string, unknown>]>;
  return calls[0][0];
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

  describe('lectura auditada (@AuditRead)', () => {
    function run(
      context: ExecutionContext,
      logMock: jest.Mock,
    ): Promise<Record<string, unknown>> {
      const interceptor = new AuditInterceptor({
        log: logMock,
      } as unknown as AuditService);
      return new Promise((resolve) => {
        interceptor.intercept(context, buildCallHandler()).subscribe(() => {
          resolve(firstLogEntry(logMock));
        });
      });
    }

    it('mantiene VIEW y el detalle base cuando el handler no tiene decorador', async () => {
      const logMock = jest.fn().mockResolvedValue(undefined);
      const entry = await run(buildContext(), logMock);
      expect(entry.action).toBe('VIEW');
      expect(entry.detail).toBe('GET /api/v1/patients/abc');
    });

    it('registra la IP real del cliente (req.clientIp) y no la del proxy (issue #301)', async () => {
      const logMock = jest.fn().mockResolvedValue(undefined);
      const entry = await run(
        buildContext({ ip: '10.0.0.5', clientIp: '198.51.100.20' }),
        logMock,
      );
      expect(entry.ipAddress).toBe('198.51.100.20');
    });

    it('sin req.clientIp cae a req.ip', async () => {
      const logMock = jest.fn().mockResolvedValue(undefined);
      const entry = await run(buildContext({ ip: '10.0.0.5' }), logMock);
      expect(entry.ipAddress).toBe('10.0.0.5');
    });

    it('sobrescribe la acción con la del decorador', async () => {
      class Ctrl {
        @AuditRead({ action: 'EXPORT_PDF' })
        handler() {}
      }
      const logMock = jest.fn().mockResolvedValue(undefined);
      const entry = await run(buildContext({}, handlerOf(Ctrl)), logMock);
      expect(entry.action).toBe('EXPORT_PDF');
      expect(entry.resourceId).toBe('abc');
    });

    it('agrega la marca de detalle sin cambiar la acción por defecto', async () => {
      class Ctrl {
        @AuditRead({ detail: 'download' })
        handler() {}
      }
      const logMock = jest.fn().mockResolvedValue(undefined);
      const entry = await run(buildContext({}, handlerOf(Ctrl)), logMock);
      expect(entry.action).toBe('VIEW');
      expect(entry.detail).toBe('GET /api/v1/patients/abc download');
    });

    it('agrega patientId al detalle cuando el handler lo expone, sin alterar resourceId', async () => {
      const logMock = jest.fn().mockResolvedValue(undefined);
      const entry = await run(
        buildContext({ auditPatientId: 'pat-9' }),
        logMock,
      );
      expect(entry.detail).toBe('GET /api/v1/patients/abc patientId=pat-9');
      expect(entry.resourceId).toBe('abc');
    });

    it('sigue siendo fail-open si el registro falla con acción sobrescrita', (done) => {
      class Ctrl {
        @AuditRead({ action: 'EXPORT_PDF' })
        handler() {}
      }
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const logMock = jest.fn().mockRejectedValue(new Error('caído'));
      const interceptor = new AuditInterceptor({
        log: logMock,
      } as unknown as AuditService);
      interceptor
        .intercept(buildContext({}, handlerOf(Ctrl)), buildCallHandler())
        .subscribe((value) => {
          expect(value).toEqual({ ok: true });
          setImmediate(() => {
            expect(errorSpy).toHaveBeenCalledTimes(1);
            errorSpy.mockRestore();
            done();
          });
        });
    });
  });

  describe('@SkipAudit', () => {
    it('no registra nada en un handler marcado con @SkipAudit()', (done) => {
      class Ctrl {
        @SkipAudit()
        handler() {}
      }
      const logMock = jest.fn().mockResolvedValue(undefined);
      const interceptor = new AuditInterceptor({
        log: logMock,
      } as unknown as AuditService);
      interceptor
        .intercept(buildContext({}, handlerOf(Ctrl)), buildCallHandler())
        .subscribe(() => {
          setImmediate(() => {
            expect(logMock).not.toHaveBeenCalled();
            done();
          });
        });
    });
  });

  describe('accesos denegados sobre recursos clínicos', () => {
    function runError(
      error: unknown,
      logMock: jest.Mock,
      overrides: Partial<any> = {},
      handler?: () => void,
    ): Promise<unknown> {
      const interceptor = new AuditInterceptor({
        log: logMock,
      } as unknown as AuditService);
      return new Promise((resolve) => {
        interceptor
          .intercept(buildContext(overrides, handler), {
            handle: () => throwError(() => error),
          })
          .subscribe({
            error: (e: unknown) => setImmediate(() => resolve(e)),
          });
      });
    }

    it('registra UNAUTHORIZED_ATTEMPT en un 403 y relanza el mismo error', async () => {
      const logMock = jest.fn().mockResolvedValue(undefined);
      const error = new ForbiddenException('No autorizado');
      const thrown = await runError(error, logMock);
      expect(thrown).toBe(error);
      expect(logMock).toHaveBeenCalledTimes(1);
      expect(firstLogEntry(logMock)).toEqual({
        userId: 'user-1',
        action: 'UNAUTHORIZED_ATTEMPT',
        resource: 'Patient',
        resourceId: 'abc',
        detail: 'GET /api/v1/patients/abc status=403',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      });
    });

    it('registra UNAUTHORIZED_ATTEMPT en un 404 de un recurso clínico', async () => {
      const logMock = jest.fn().mockResolvedValue(undefined);
      const error = new NotFoundException();
      const thrown = await runError(error, logMock, {
        url: '/api/v1/consultations/xyz',
        params: { id: 'xyz' },
      });
      expect(thrown).toBe(error);
      const entry = firstLogEntry(logMock);
      expect(entry.resource).toBe('Consultation');
      expect(entry.resourceId).toBe('xyz');
      expect(entry.detail).toBe('GET /api/v1/consultations/xyz status=404');
    });

    it('no registra un 401 (ya lo hace el guard JWT)', async () => {
      const logMock = jest.fn().mockResolvedValue(undefined);
      await runError(new UnauthorizedException(), logMock);
      expect(logMock).not.toHaveBeenCalled();
    });

    it('no registra errores 400 ni errores no HTTP', async () => {
      const logMock = jest.fn().mockResolvedValue(undefined);
      await runError(new BadRequestException(), logMock);
      await runError(new Error('boom'), logMock);
      expect(logMock).not.toHaveBeenCalled();
    });

    it('no registra un 404 en recursos no clínicos', async () => {
      const logMock = jest.fn().mockResolvedValue(undefined);
      await runError(new NotFoundException(), logMock, {
        url: '/api/v1/notifications/abc',
      });
      expect(logMock).not.toHaveBeenCalled();
    });

    it('respeta @SkipAudit en el camino de error', async () => {
      class Ctrl {
        @SkipAudit()
        handler() {}
      }
      const logMock = jest.fn().mockResolvedValue(undefined);
      await runError(new ForbiddenException(), logMock, {}, handlerOf(Ctrl));
      expect(logMock).not.toHaveBeenCalled();
    });

    it('es fail-open: si el registro falla, relanza el error original y reporta', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const logMock = jest.fn().mockRejectedValue(new Error('caído'));
      const error = new ForbiddenException();
      const thrown = await runError(error, logMock);
      expect(thrown).toBe(error);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain(
        'Fallo al registrar intento no autorizado',
      );
      errorSpy.mockRestore();
    });
  });

  describe('handlers con @Res() (integración HTTP)', () => {
    @Controller('files')
    class FilesController {
      @AuditRead({ detail: 'download' })
      @Get(':id/download')
      download(
        @Param('id') id: string,
        @Req() req: Request & { auditPatientId?: string },
        @Res() res: Response,
      ) {
        req.auditPatientId = 'pat-1';
        res.end(Buffer.from(id));
      }
    }

    let app: INestApplication;
    const logMock = jest.fn().mockResolvedValue(undefined);

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [FilesController],
        providers: [
          { provide: AuditService, useValue: { log: logMock } },
          { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      // Simula al JwtAuthGuard: el interceptor solo audita con usuario.
      app.use(
        (
          req: Request & { user?: unknown },
          _res: Response,
          next: () => void,
        ) => {
          req.user = { id: 'user-1' };
          next();
        },
      );
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('el interceptor registra aunque el handler use @Res() y cierre la respuesta', async () => {
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get('/files/doc-1/download')
        .expect(200);
      await new Promise((r) => setImmediate(r));
      expect(logMock).toHaveBeenCalledTimes(1);
      const entry = firstLogEntry(logMock);
      expect(entry.resourceId).toBe('doc-1');
      expect(entry.detail).toBe(
        'GET /files/doc-1/download download patientId=pat-1',
      );
    });
  });
});
