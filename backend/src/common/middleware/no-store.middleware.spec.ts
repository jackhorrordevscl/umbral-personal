import type { Request, Response } from 'express';
import { NoStoreMiddleware } from './no-store.middleware';

describe('NoStoreMiddleware', () => {
  it('marca la respuesta como no almacenable y sigue la cadena', () => {
    const setHeader = jest.fn();
    const next = jest.fn();

    new NoStoreMiddleware().use(
      {} as Request,
      { setHeader } as unknown as Response,
      next,
    );

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
