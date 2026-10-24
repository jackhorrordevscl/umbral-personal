import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildReportsThrottlerOptions } from './reports.module';
import { ReportsController } from './reports.controller';

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

type ReportsThrottler = {
  name: string;
  limit: unknown;
  ttl: unknown;
  skipIf: (context: ExecutionContext) => boolean;
};

function reportsThrottler(values: Record<string, string>): ReportsThrottler {
  const options = buildReportsThrottlerOptions(configWith(values)) as {
    throttlers: ReportsThrottler[];
  };
  const throttler = options.throttlers.find((t) => t.name === 'reports-export');
  if (!throttler) throw new Error('throttler reports-export no registrado');
  return throttler;
}

function contextOf(controller: new (...args: never[]) => unknown) {
  return { getClass: () => controller } as unknown as ExecutionContext;
}

// Issue #504: el PDF del expediente descifra todas las consultas y se arma en
// el event loop. Sin tope de pedidos, un cliente autenticado puede dejar lento
// el servidor para todos los terapeutas.
describe('buildReportsThrottlerOptions', () => {
  it('permite 5 exportaciones por minuto por defecto en producción', () => {
    expect(reportsThrottler({ NODE_ENV: 'production' })).toMatchObject({
      limit: 5,
      ttl: 60000,
    });
  });

  it('respeta REPORTS_EXPORT_THROTTLE_LIMIT y REPORTS_EXPORT_THROTTLE_TTL_MS', () => {
    expect(
      reportsThrottler({
        NODE_ENV: 'production',
        REPORTS_EXPORT_THROTTLE_LIMIT: '2',
        REPORTS_EXPORT_THROTTLE_TTL_MS: '30000',
      }),
    ).toMatchObject({ limit: 2, ttl: 30000 });
  });

  it('vuelve al default ante un REPORTS_EXPORT_THROTTLE_LIMIT inválido', () => {
    expect(
      reportsThrottler({
        NODE_ENV: 'production',
        REPORTS_EXPORT_THROTTLE_LIMIT: 'abc',
      }),
    ).toMatchObject({ limit: 5 });
  });

  it('mantiene el límite alto de NODE_ENV=test', () => {
    expect(reportsThrottler({ NODE_ENV: 'test' })).toMatchObject({
      limit: 1000,
    });
  });

  it('solo aplica al ReportsController: salta cualquier otro controller', () => {
    const { skipIf } = reportsThrottler({ NODE_ENV: 'production' });

    expect(skipIf(contextOf(ReportsController))).toBe(false);
    expect(skipIf(contextOf(class OtroController {}))).toBe(true);
  });
});
