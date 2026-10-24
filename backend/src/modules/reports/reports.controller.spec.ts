import { CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AuditService } from '../audit/audit.service';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

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
