import { BadRequestException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentAccountService } from './payment-account.service';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { GatewayContext, GatewayCredentials } from './payment-gateway.client';

// sdd/payments-multigateway-redesign (design.md "Webhook — after"): POST
// /payments/confirm is public (no JwtAuthGuard) -- the module's primary
// attack surface. This unit test exercises the NARROWEST layer (the
// controller handler with PaymentsService/PaymentAccountService/
// PaymentGatewayRegistry mocked) so "no mutation before the signature
// check" is literal: paymentsService.confirm (the only path that touches
// Prisma) is never invoked unless BOTH the token resolves to a real
// payment AND the owning account's credentials verify the signature. The
// e2e (test/payments.e2e-spec.ts) proves the same thing end-to-end against
// a real Prisma DB with a seeded CONNECTED account.
describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: {
    assertOwnership: jest.Mock;
    updateAmount: jest.Mock;
    resendPaymentLink: jest.Mock;
    confirm: jest.Mock;
    findByToken: jest.Mock;
    resolveReturnRedirectUrl: jest.Mock;
  };
  let paymentAccountService: {
    status: jest.Mock;
    validate: jest.Mock;
    connect: jest.Mock;
    disconnect: jest.Mock;
    resolveGatewayContext: jest.Mock;
  };
  let gatewayAdapter: { verifyCallbackSignature: jest.Mock };
  let gatewayRegistry: { get: jest.Mock };

  function buildContext(
    overrides: Partial<GatewayContext> = {},
  ): GatewayContext {
    return {
      provider: PaymentProvider.FLOW,
      credentials: new GatewayCredentials('test-api-key', 'test-secret-key'),
      ...overrides,
    };
  }

  beforeEach(() => {
    paymentsService = {
      assertOwnership: jest.fn().mockResolvedValue({ id: 'payment-1' }),
      updateAmount: jest
        .fn()
        .mockResolvedValue({ id: 'payment-1', amount: 45000 }),
      resendPaymentLink: jest
        .fn()
        .mockResolvedValue({ id: 'payment-1', linkDelivery: 'SENT' }),
      confirm: jest.fn().mockResolvedValue(undefined),
      findByToken: jest.fn(),
      resolveReturnRedirectUrl: jest
        .fn()
        .mockReturnValue('http://localhost:5173/pago-recibido'),
    };
    paymentAccountService = {
      status: jest.fn(),
      validate: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      resolveGatewayContext: jest.fn(),
    };
    gatewayAdapter = { verifyCallbackSignature: jest.fn() };
    gatewayRegistry = { get: jest.fn().mockReturnValue(gatewayAdapter) };

    controller = new PaymentsController(
      paymentsService as unknown as PaymentsService,
      paymentAccountService as unknown as PaymentAccountService,
      gatewayRegistry as unknown as PaymentGatewayRegistry,
    );
  });

  describe('confirm', () => {
    // sdd/payments-multigateway-redesign task 3.7 + spec "Checkout is
    // unavailable if the owning account is no longer connected": an
    // unknown token is rejected with the SAME uniform 400 as an invalid
    // signature, but strictly BEFORE any context resolution or decryption
    // is even attempted -- the read-only findByToken lookup precedes
    // everything else, and nothing downstream of it ever runs.
    it('con token desconocido rechaza con 400 sin resolver contexto, sin decidir firma y sin mutar nada', async () => {
      paymentsService.findByToken.mockResolvedValue(null);

      await expect(
        controller.confirm({
          token: 'token-desconocido',
          s: 'cualquier-firma',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(
        paymentAccountService.resolveGatewayContext,
      ).not.toHaveBeenCalled();
      expect(gatewayRegistry.get).not.toHaveBeenCalled();
      expect(gatewayAdapter.verifyCallbackSignature).not.toHaveBeenCalled();
      expect(paymentsService.confirm).not.toHaveBeenCalled();
    });

    // spec "Checkout is unavailable if the owning account is no longer
    // connected": a known token whose owning account is no longer
    // CONNECTED (resolveGatewayContext -> null covers
    // RECONNECT_REQUIRED/DISCONNECTED) also rejects with the same uniform
    // 400, with no signature to even check against and no mutation.
    it('con cuenta dueña ya no conectada (contexto null) rechaza con 400 sin verificar firma ni mutar nada', async () => {
      paymentsService.findByToken.mockResolvedValue({
        id: 'payment-1',
        therapistId: 'therapist-1',
      });
      paymentAccountService.resolveGatewayContext.mockResolvedValue(null);

      await expect(
        controller.confirm({ token: 'flow-token', s: 'firma-cualquiera' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(gatewayRegistry.get).not.toHaveBeenCalled();
      expect(gatewayAdapter.verifyCallbackSignature).not.toHaveBeenCalled();
      expect(paymentsService.confirm).not.toHaveBeenCalled();
    });

    it('con firma inválida (credenciales resueltas) rechaza con 400 y nunca llama a paymentsService.confirm', async () => {
      paymentsService.findByToken.mockResolvedValue({
        id: 'payment-1',
        therapistId: 'therapist-1',
      });
      paymentAccountService.resolveGatewayContext.mockResolvedValue(
        buildContext(),
      );
      gatewayAdapter.verifyCallbackSignature.mockReturnValue(false);

      await expect(
        controller.confirm({ token: 'flow-token', s: 'firma-falsificada' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(paymentsService.confirm).not.toHaveBeenCalled();
    });

    it('con firma válida llama a paymentsService.confirm con el token', async () => {
      paymentsService.findByToken.mockResolvedValue({
        id: 'payment-1',
        therapistId: 'therapist-1',
      });
      const context = buildContext();
      paymentAccountService.resolveGatewayContext.mockResolvedValue(context);
      gatewayAdapter.verifyCallbackSignature.mockReturnValue(true);

      const result = await controller.confirm({
        token: 'flow-token',
        s: 'firma-valida',
      });

      expect(gatewayRegistry.get).toHaveBeenCalledWith(context.provider);
      expect(paymentsService.confirm).toHaveBeenCalledWith('flow-token');
      expect(result).toEqual({ received: true });
    });

    it('verifica la firma con las credenciales de la cuenta dueña, sobre exactamente { token, s }', async () => {
      paymentsService.findByToken.mockResolvedValue({
        id: 'payment-1',
        therapistId: 'therapist-1',
      });
      const context = buildContext();
      paymentAccountService.resolveGatewayContext.mockResolvedValue(context);
      gatewayAdapter.verifyCallbackSignature.mockReturnValue(true);

      await controller.confirm({ token: 'flow-token', s: 'firma-valida' });

      expect(paymentAccountService.resolveGatewayContext).toHaveBeenCalledWith(
        'therapist-1',
      );
      expect(gatewayAdapter.verifyCallbackSignature).toHaveBeenCalledWith(
        context.credentials,
        { token: 'flow-token', s: 'firma-valida' },
      );
    });
  });

  describe('account/validate (POST /payments/account/validate)', () => {
    it('delega en paymentAccountService.validate con el body (sin therapistId -- no persiste nada)', async () => {
      paymentAccountService.validate.mockResolvedValue({
        keyFingerprint: 'fp-1',
      });

      const result = await controller.validateAccount({
        apiKey: 'a'.repeat(32),
        secretKey: 'b'.repeat(32),
      });

      expect(paymentAccountService.validate).toHaveBeenCalledWith({
        apiKey: 'a'.repeat(32),
        secretKey: 'b'.repeat(32),
      });
      expect(result).toEqual({ keyFingerprint: 'fp-1' });
    });
  });

  describe('account (POST /payments/account)', () => {
    it('delega en paymentAccountService.connect con el therapistId autenticado', async () => {
      paymentAccountService.connect.mockResolvedValue({ status: 'CONNECTED' });

      await controller.connectAccount(
        { apiKey: 'a'.repeat(32), secretKey: 'b'.repeat(32) },
        { id: 'therapist-1', email: '', role: '', name: '' },
      );

      expect(paymentAccountService.connect).toHaveBeenCalledWith(
        'therapist-1',
        { apiKey: 'a'.repeat(32), secretKey: 'b'.repeat(32) },
      );
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

  describe('resendLink (POST /payments/:groupId/resend-link)', () => {
    it('verifica ownership del terapeuta ANTES de reenviar el link', async () => {
      const callOrder: string[] = [];
      paymentsService.assertOwnership.mockImplementation(() => {
        callOrder.push('assertOwnership');
        return Promise.resolve({ id: 'payment-1' });
      });
      paymentsService.resendPaymentLink.mockImplementation(() => {
        callOrder.push('resendPaymentLink');
        return Promise.resolve({ id: 'payment-1', linkDelivery: 'SENT' });
      });

      await controller.resendLink('group-1', {
        id: 'therapist-1',
        email: '',
        role: '',
        name: '',
      });

      expect(callOrder).toEqual(['assertOwnership', 'resendPaymentLink']);
      expect(paymentsService.assertOwnership).toHaveBeenCalledWith(
        'group-1',
        'therapist-1',
      );
      expect(paymentsService.resendPaymentLink).toHaveBeenCalledWith(
        'group-1',
      );
    });

    it('propaga el 404 de assertOwnership sin llamar a resendPaymentLink (tenancy)', async () => {
      paymentsService.assertOwnership.mockRejectedValue(
        new Error('No existe un cargo para esta sesión.'),
      );

      await expect(
        controller.resendLink('group-de-otro-terapeuta', {
          id: 'therapist-2',
          email: '',
          role: '',
          name: '',
        }),
      ).rejects.toThrow();

      expect(paymentsService.resendPaymentLink).not.toHaveBeenCalled();
    });
  });

  // Bug fix: returnUrl used to point straight at the frontend's
  // PAYMENT_RETURN_PATH, which 404'd (a static SPA route has no handler for
  // Flow's browser-submitted POST) -- this public route (no guard, same
  // tier as /confirm) exists only to 302-redirect the patient's browser to
  // the real frontend page.
  describe('return (GET|POST /payments/return)', () => {
    function buildRes() {
      return { redirect: jest.fn() } as unknown as {
        redirect: jest.Mock;
      };
    }

    it('POST redirige (302) a la URL resuelta por paymentsService con el token del body', () => {
      const res = buildRes();
      paymentsService.resolveReturnRedirectUrl.mockReturnValue(
        'http://localhost:5173/pago-recibido?token=flow-token-abc',
      );

      controller.returnFromGatewayPost(
        'flow-token-abc',
        res as unknown as Parameters<
          PaymentsController['returnFromGatewayPost']
        >[1],
      );

      expect(paymentsService.resolveReturnRedirectUrl).toHaveBeenCalledWith(
        'flow-token-abc',
      );
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        'http://localhost:5173/pago-recibido?token=flow-token-abc',
      );
    });

    it('GET redirige (302) a la URL resuelta por paymentsService con el token del query', () => {
      const res = buildRes();

      controller.returnFromGatewayGet(
        'flow-token-abc',
        res as unknown as Parameters<
          PaymentsController['returnFromGatewayGet']
        >[1],
      );

      expect(paymentsService.resolveReturnRedirectUrl).toHaveBeenCalledWith(
        'flow-token-abc',
      );
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        'http://localhost:5173/pago-recibido',
      );
    });

    it('sin token (undefined) igual redirige -- nunca bloquea al paciente', () => {
      const res = buildRes();

      controller.returnFromGatewayPost(
        undefined,
        res as unknown as Parameters<
          PaymentsController['returnFromGatewayPost']
        >[1],
      );

      expect(paymentsService.resolveReturnRedirectUrl).toHaveBeenCalledWith(
        undefined,
      );
      expect(res.redirect).toHaveBeenCalledWith(302, expect.any(String));
    });
  });
});
