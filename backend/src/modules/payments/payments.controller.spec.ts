import { BadRequestException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentAccountService } from './payment-account.service';
import { PaymentGatewayClient } from './payment-gateway.client';

// sdd/online-payment-integration PR 2 (T7.1/T7.9/T7.10): POST /payments/confirm
// es público (sin JwtAuthGuard) -- la superficie de ataque primaria de todo
// el módulo. Este test unitario prueba la capa MÁS estrecha (el handler del
// controller con PaymentsService/gateway mockeados) para que "assert Prisma
// mock untouched" (T7.1) sea literal: PaymentsService.confirm (el único
// punto que toca Prisma) nunca se invoca cuando la firma es inválida. El
// e2e (payments.e2e-spec.ts, T7.9) prueba lo mismo de punta a punta contra
// Prisma real.
describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: {
    assertOwnership: jest.Mock;
    updateAmount: jest.Mock;
    confirm: jest.Mock;
  };
  let paymentAccountService: {
    status: jest.Mock;
    onboard: jest.Mock;
    disconnect: jest.Mock;
  };
  let gateway: { verifyCallbackSignature: jest.Mock };

  beforeEach(() => {
    paymentsService = {
      assertOwnership: jest.fn().mockResolvedValue({ id: 'payment-1' }),
      updateAmount: jest
        .fn()
        .mockResolvedValue({ id: 'payment-1', amount: 45000 }),
      confirm: jest.fn().mockResolvedValue(undefined),
    };
    paymentAccountService = {
      status: jest.fn(),
      onboard: jest.fn(),
      disconnect: jest.fn(),
    };
    gateway = { verifyCallbackSignature: jest.fn() };

    controller = new PaymentsController(
      paymentsService as unknown as PaymentsService,
      paymentAccountService as unknown as PaymentAccountService,
      gateway as unknown as PaymentGatewayClient,
    );
  });

  describe('confirm', () => {
    it('con firma inválida rechaza con 400 y nunca llama a paymentsService.confirm (ni toca Prisma)', async () => {
      gateway.verifyCallbackSignature.mockReturnValue(false);

      await expect(
        controller.confirm({ token: 'flow-token', s: 'firma-falsificada' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(paymentsService.confirm).not.toHaveBeenCalled();
    });

    it('con firma válida llama a paymentsService.confirm con el token', async () => {
      gateway.verifyCallbackSignature.mockReturnValue(true);

      const result = await controller.confirm({
        token: 'flow-token',
        s: 'firma-valida',
      });

      expect(paymentsService.confirm).toHaveBeenCalledWith('flow-token');
      expect(result).toEqual({ received: true });
    });

    it('verifica la firma sobre exactamente { token, s } -- nunca reenvía campos adicionales del body', async () => {
      gateway.verifyCallbackSignature.mockReturnValue(true);

      await controller.confirm({ token: 'flow-token', s: 'firma-valida' });

      expect(gateway.verifyCallbackSignature).toHaveBeenCalledWith({
        token: 'flow-token',
        s: 'firma-valida',
      });
    });
  });

  describe('updateAmount (PATCH /payments/:groupId)', () => {
    it('verifica ownership del terapeuta ANTES de llamar a updateAmount', async () => {
      const callOrder: string[] = [];
      paymentsService.assertOwnership.mockImplementation(() => {
        callOrder.push('assertOwnership');
        return Promise.resolve({ id: 'payment-1' });
      });
      paymentsService.updateAmount.mockImplementation(() => {
        callOrder.push('updateAmount');
        return Promise.resolve({ id: 'payment-1', amount: 45000 });
      });

      await controller.updateAmount(
        'group-1',
        { amount: 45000 },
        { id: 'therapist-1', email: '', role: '', name: '' },
      );

      expect(callOrder).toEqual(['assertOwnership', 'updateAmount']);
      expect(paymentsService.assertOwnership).toHaveBeenCalledWith(
        'group-1',
        'therapist-1',
      );
      expect(paymentsService.updateAmount).toHaveBeenCalledWith(
        'group-1',
        45000,
      );
    });

    it('propaga el 404 de assertOwnership sin llamar a updateAmount (tenancy, T7.7)', async () => {
      paymentsService.assertOwnership.mockRejectedValue(
        new Error('No existe un cargo para esta sesión.'),
      );

      await expect(
        controller.updateAmount(
          'group-de-otro-terapeuta',
          { amount: 45000 },
          { id: 'therapist-2', email: '', role: '', name: '' },
        ),
      ).rejects.toThrow();

      expect(paymentsService.updateAmount).not.toHaveBeenCalled();
    });
  });
});
