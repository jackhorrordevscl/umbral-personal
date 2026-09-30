import {
  parsePositiveIntEnv,
  UnauthorizedAttemptLimiter,
} from './unauthorized-attempt-limiter.util';

describe('UnauthorizedAttemptLimiter', () => {
  it('permite hasta el límite por IP dentro de la ventana y luego bloquea', () => {
    const limiter = new UnauthorizedAttemptLimiter();
    expect(limiter.allow('1.1.1.1', 2, 1000, 0)).toBe(true);
    expect(limiter.allow('1.1.1.1', 2, 1000, 1)).toBe(true);
    expect(limiter.allow('1.1.1.1', 2, 1000, 2)).toBe(false);
    // otra IP tiene su propio presupuesto
    expect(limiter.allow('2.2.2.2', 2, 1000, 2)).toBe(true);
  });

  it('reabre la ventana al vencer', () => {
    const limiter = new UnauthorizedAttemptLimiter();
    expect(limiter.allow('1.1.1.1', 1, 1000, 0)).toBe(true);
    expect(limiter.allow('1.1.1.1', 1, 1000, 999)).toBe(false);
    expect(limiter.allow('1.1.1.1', 1, 1000, 1000)).toBe(true);
  });

  it('acota las IPs rastreadas: purga las vencidas y rechaza nuevas si sigue lleno', () => {
    const limiter = new UnauthorizedAttemptLimiter();
    for (let i = 0; i < 10_000; i++) limiter.allow(`ip-${i}`, 1, 1000, 0);
    expect(limiter.size).toBe(10_000);
    // lleno y sin vencidas: una IP nueva no se registra
    expect(limiter.allow('nueva', 1, 1000, 500)).toBe(false);
    expect(limiter.size).toBe(10_000);
    // con las ventanas vencidas se purgan y entra
    expect(limiter.allow('nueva', 1, 1000, 2000)).toBe(true);
    expect(limiter.size).toBe(1);
  });
});

describe('parsePositiveIntEnv', () => {
  it('usa el fallback para valores ausentes o inválidos', () => {
    expect(parsePositiveIntEnv(undefined, 10)).toBe(10);
    expect(parsePositiveIntEnv('0', 10)).toBe(10);
    expect(parsePositiveIntEnv('x', 10)).toBe(10);
    expect(parsePositiveIntEnv('5', 10)).toBe(5);
  });
});
