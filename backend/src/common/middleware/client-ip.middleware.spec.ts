import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  ClientIpMiddleware,
  parseTrustedProxyHops,
} from './client-ip.middleware';

function configWith(value: string | undefined): ConfigService {
  return { get: () => value } as unknown as ConfigService;
}

function run(middleware: ClientIpMiddleware, req: Record<string, unknown>) {
  const next = jest.fn();
  middleware.use(req as unknown as Request, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  return (req as { clientIp?: string }).clientIp;
}

describe('ClientIpMiddleware', () => {
  it('deja en req.clientIp la IP real según TRUSTED_PROXY_HOPS', () => {
    const middleware = new ClientIpMiddleware(configWith('3'));
    const clientIp = run(middleware, {
      ip: '127.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.7, 172.68.1.1, 10.0.0.1' },
    });
    expect(clientIp).toBe('198.51.100.7');
  });

  it('cae a req.ip con una XFF más corta que los hops', () => {
    const middleware = new ClientIpMiddleware(configWith('3'));
    const clientIp = run(middleware, {
      ip: '127.0.0.1',
      headers: { 'x-forwarded-for': '6.6.6.6' },
    });
    expect(clientIp).toBe('127.0.0.1');
  });

  it('un TRUSTED_PROXY_HOPS inválido usa 1 y avisa', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    expect(parseTrustedProxyHops('abc')).toBe(1);
    expect(parseTrustedProxyHops(undefined)).toBe(1);
    expect(parseTrustedProxyHops('3')).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
