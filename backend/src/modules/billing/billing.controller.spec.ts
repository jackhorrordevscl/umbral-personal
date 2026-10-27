import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { BillingController } from './billing.controller';
import { BillingService, ConfirmOutcome } from './billing.service';

describe('BillingController', () => {
  let billing: {
    createCheckout: jest.Mock;
    confirmByToken: jest.Mock;
    frontendReturnUrl: jest.Mock;
  };
  let controller: BillingController;

  beforeEach(() => {
    billing = {
      createCheckout: jest.fn(),
      confirmByToken: jest.fn(),
      frontendReturnUrl: jest.fn().mockReturnValue('https://app.test/retorno'),
    };
    controller = new BillingController(billing as unknown as BillingService);
  });

  it('checkout cobra a la cuenta autenticada (nunca a un id del request)', async () => {
    billing.createCheckout.mockResolvedValue({ paymentUrl: 'https://flow/p' });

    const result = await controller.checkout({ id: 'u1' } as never);

    expect(billing.createCheckout).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ paymentUrl: 'https://flow/p' });
  });

  it.each<ConfirmOutcome>([
    'applied',
    'already_applied',
    'pending',
    'failed',
    'anomaly',
  ])('confirm responde 200 para un pago conocido (%s)', async (outcome) => {
    billing.confirmByToken.mockResolvedValue(outcome);

    await expect(controller.confirm({ token: 't' })).resolves.toEqual({
      received: true,
    });
  });

  it('confirm devuelve el mismo 400 uniforme para token desconocido y para error de Flow', async () => {
    billing.confirmByToken.mockResolvedValueOnce('unknown');
    const unknown = await controller
      .confirm({ token: 't' })
      .catch((e: unknown) => e);
    billing.confirmByToken.mockRejectedValueOnce(new Error('timeout'));
    const flowError = await controller
      .confirm({ token: 't' })
      .catch((e: unknown) => e);

    expect(unknown).toBeInstanceOf(BadRequestException);
    expect(flowError).toBeInstanceOf(BadRequestException);
    expect((unknown as BadRequestException).message).toBe(
      (flowError as BadRequestException).message,
    );
  });

  it('return redirige 302 al frontend por POST y por GET', () => {
    const res = { redirect: jest.fn() };

    controller.returnPost(res as unknown as Response);
    controller.returnGet(res as unknown as Response);

    expect(res.redirect).toHaveBeenNthCalledWith(
      1,
      302,
      'https://app.test/retorno',
    );
    expect(res.redirect).toHaveBeenNthCalledWith(
      2,
      302,
      'https://app.test/retorno',
    );
  });
});
