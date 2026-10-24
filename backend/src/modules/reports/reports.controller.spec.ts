import { CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { buildAppThrottlerOptions } from '../../config/throttler.config';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AuditService } from '../audit/audit.service';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

// @nestjs/throttler no exporta THROTTLER_SKIP en su API pública -- mismo
// criterio que profile.controller.spec.ts.
const THROTTLER_SKIP = 'THROTTLER:SKIP';

// Simula al JwtAuthGuard real: deja al terapeuta en request.user.
class FakeJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: unknown }>();
    req.user = { id: 'user-1' };
    return true;
  }
}

describe('ReportsController', () => {
  let app: INestApplication;
  const pdf = Buffer.from('%PDF-1.4 ficha');
  const generatePatientReport = jest.fn();
  const logMock = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot(
          buildAppThrottlerOptions(new ConfigService({ NODE_ENV: 'test' })),
        ),
      ],
      controllers: [ReportsController],
      providers: [
        { provide: ReportsService, useValue: { generatePatientReport } },
        { provide: AuditService, useValue: { log: logMock } },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtAuthGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    generatePatientReport.mockResolvedValue(pdf);
    logMock.mockResolvedValue(undefined);
  });

  function exportReport() {
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/reports/patient/pat-1')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  }

  it('entrega el PDF con sus encabezados y registra EXPORT_PDF', async () => {
    const res = await exportReport().expect(200);

    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="ficha-pat-1.pdf"',
    );
    expect(res.headers['content-length']).toBe(String(pdf.length));
    expect((res.body as Buffer).equals(pdf)).toBe(true);
    expect(generatePatientReport).toHaveBeenCalledWith('pat-1', 'user-1');
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'EXPORT_PDF',
        resource: 'Report',
        resourceId: 'pat-1',
      }),
    );
  });

  it('si no se puede escribir la auditoría, no entrega el PDF (500)', async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    logMock.mockRejectedValue(new Error('base de auditoría caída'));

    const res = await exportReport().expect(500);

    expect(res.headers['content-type']).not.toContain('application/pdf');
    expect((res.body as Buffer).includes(pdf)).toBe(false);
    errorSpy.mockRestore();
  });
});

// Issue #504: tope de exportaciones por terapeuta. Se monta con el registro
// real de la app (buildAppThrottlerOptions) para fijar también que el throttler
// llega registrado y que el tracker es el id del usuario, no la IP.
describe('ReportsController: tope de exportaciones', () => {
  let app: INestApplication;
  const generatePatientReport = jest.fn();
  const appOptions = buildAppThrottlerOptions(
    new ConfigService({
      NODE_ENV: 'production',
      REPORTS_EXPORT_THROTTLE_LIMIT: '2',
    }),
  );

  // Deja en request.user el terapeuta indicado en el encabezado x-user.
  class HeaderJwtAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<{
        user?: unknown;
        headers: Record<string, string>;
      }>();
      req.user = { id: req.headers['x-user'] };
      return true;
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(appOptions)],
      controllers: [ReportsController],
      providers: [
        { provide: ReportsService, useValue: { generatePatientReport } },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(HeaderJwtAuthGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    generatePatientReport.mockResolvedValue(Buffer.from('%PDF-1.4 ficha'));
  });

  function exportAs(userId: string) {
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/reports/patient/pat-1')
      .set('x-user', userId);
  }

  it('responde 429 al superar el tope y no vuelve a generar el PDF', async () => {
    await exportAs('user-a').expect(200);
    await exportAs('user-a').expect(200);
    generatePatientReport.mockClear();

    await exportAs('user-a').expect(429);

    expect(generatePatientReport).not.toHaveBeenCalled();
  });

  it('el tope es por terapeuta: otro usuario sigue exportando', async () => {
    await exportAs('user-b').expect(200);
  });

  // ThrottlerModule es @Global(): todos los throttlers nombrados aplican a
  // cualquier ruta con ThrottlerGuard. Recorre los registrados (no una lista
  // fija) para que uno nuevo sin saltar acá rompa este test.
  it('saltea todos los throttlers ajenos', () => {
    const reflector = new Reflector();
    const foreign = (
      appOptions as { throttlers: { name: string }[] }
    ).throttlers
      .map((t) => t.name)
      .filter((name) => name !== 'reports-export');

    expect(foreign.length).toBeGreaterThan(0);
    for (const name of foreign) {
      expect(
        reflector.get<boolean | undefined>(
          THROTTLER_SKIP + name,
          ReportsController,
        ),
      ).toBe(true);
    }
  });
});
