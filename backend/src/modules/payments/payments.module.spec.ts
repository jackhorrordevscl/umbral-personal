import { ConfigService } from '@nestjs/config';
import { buildPaymentsThrottlerOptions } from './payments.module';

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

function throttlerNamed(
  values: Record<string, string>,
  name: string,
): { limit: unknown; ttl: unknown } {
  const options = buildPaymentsThrottlerOptions(configWith(values)) as {
    throttlers: { name: string; limit: unknown; ttl: unknown }[];
  };
  const throttler = options.throttlers.find((t) => t.name === name);
  if (!throttler) throw new Error(`throttler ${name} no registrado`);
  return throttler;
}

// Issue #494: todos los callbacks de Flow de todos los terapeutas salen de
// pocas IP y comparten el cupo de 'payment-confirm'. El default tiene que
// dejar pasar el tráfico legítimo de varios terapeutas a la vez.
describe('buildPaymentsThrottlerOptions', () => {
  describe('payment-confirm', () => {
    it('permite 300 confirmaciones por minuto por IP por defecto en producción', () => {
      expect(
        throttlerNamed({ NODE_ENV: 'production' }, 'payment-confirm'),
      ).toMatchObject({ limit: 300, ttl: 60000 });
    });

    it('respeta PAYMENT_CONFIRM_THROTTLE_LIMIT y PAYMENT_CONFIRM_THROTTLE_TTL_MS', () => {
      expect(
        throttlerNamed(
          {
            NODE_ENV: 'production',
            PAYMENT_CONFIRM_THROTTLE_LIMIT: '50',
            PAYMENT_CONFIRM_THROTTLE_TTL_MS: '30000',
          },
          'payment-confirm',
        ),
      ).toMatchObject({ limit: 50, ttl: 30000 });
    });

    it('vuelve al default ante un PAYMENT_CONFIRM_THROTTLE_LIMIT inválido', () => {
      expect(
        throttlerNamed(
          { NODE_ENV: 'production', PAYMENT_CONFIRM_THROTTLE_LIMIT: 'abc' },
          'payment-confirm',
        ),
      ).toMatchObject({ limit: 300 });
    });

    it('mantiene el límite alto de NODE_ENV=test', () => {
      expect(
        throttlerNamed({ NODE_ENV: 'test' }, 'payment-confirm'),
      ).toMatchObject({ limit: 1000 });
    });
  });

  describe('payment-return (sin cambios)', () => {
    it('sigue en 20 por minuto por defecto en producción', () => {
      expect(
        throttlerNamed({ NODE_ENV: 'production' }, 'payment-return'),
      ).toMatchObject({ limit: 20, ttl: 60000 });
    });
  });
});
