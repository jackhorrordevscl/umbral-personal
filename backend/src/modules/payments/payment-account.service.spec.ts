import { NotFoundException } from '@nestjs/common';
import { PaymentAccountService } from './payment-account.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PaymentGatewayClient,
  PaymentGatewayError,
} from './payment-gateway.client';
import { PaymentCredentialCryptoService } from './payment-credential-crypto.service';

// sdd/online-payment-integration PR 2 (T5.1-5.3): mismo patrón de mocking de
// Prisma que payments.service.spec.ts -- este servicio nunca toca
// Consultation/Patient, solo PaymentAccount, así que el mock queda acotado a
// ese único delegate.
describe('PaymentAccountService', () => {
  let service: PaymentAccountService;
  let prisma: {
    paymentAccount: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let gateway: { createMerchant: jest.Mock };
  let crypto: { encrypt: jest.Mock; decrypt: jest.Mock };

  const ONBOARD_INPUT = {
    name: 'Terapeuta A',
    email: 'terapeuta.a@umbral.cl',
    rutOrTaxId: '11.111.111-1',
  };

  beforeEach(() => {
    prisma = {
      paymentAccount: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    gateway = { createMerchant: jest.fn() };
    crypto = {
      encrypt: jest.fn().mockReturnValue(Buffer.from('encrypted-blob')),
      decrypt: jest.fn(),
    };

    service = new PaymentAccountService(
      prisma as unknown as PrismaService,
      gateway as unknown as PaymentGatewayClient,
      crypto as unknown as PaymentCredentialCryptoService,
    );
  });

  describe('onboard', () => {
    it('llama a gateway.createMerchant y persiste la cuenta como CONNECTED', async () => {
      gateway.createMerchant.mockResolvedValue({
        merchantId: 'flow-merchant-1',
      });
      prisma.paymentAccount.upsert.mockResolvedValue({
        therapistId: 'therapist-1',
        status: 'CONNECTED',
        merchantId: 'flow-merchant-1',
        connectedAt: new Date('2026-08-28T00:00:00.000Z'),
        lastError: null,
      });

      const result = await service.onboard('therapist-1', ONBOARD_INPUT);

      expect(gateway.createMerchant).toHaveBeenCalledWith({
        therapistId: 'therapist-1',
        name: ONBOARD_INPUT.name,
        email: ONBOARD_INPUT.email,
        rutOrTaxId: ONBOARD_INPUT.rutOrTaxId,
      });
      expect(prisma.paymentAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { therapistId: 'therapist-1' },
          create: expect.objectContaining({
            status: 'CONNECTED',
            merchantId: 'flow-merchant-1',
          }) as unknown,
        }),
      );
      expect(result.status).toBe('CONNECTED');
      expect(result).not.toHaveProperty('credentialEncrypted');
    });

    it('cifra el merchantId devuelto antes de persistirlo', async () => {
      gateway.createMerchant.mockResolvedValue({
        merchantId: 'flow-merchant-1',
      });
      prisma.paymentAccount.upsert.mockResolvedValue({
        therapistId: 'therapist-1',
        status: 'CONNECTED',
        merchantId: 'flow-merchant-1',
        connectedAt: new Date(),
        lastError: null,
      });

      await service.onboard('therapist-1', ONBOARD_INPUT);

      expect(crypto.encrypt).toHaveBeenCalledTimes(1);
      const [plaintext] = crypto.encrypt.mock.calls[0] as [Buffer];
      expect(JSON.parse(plaintext.toString('utf-8'))).toEqual({
        merchantId: 'flow-merchant-1',
      });
    });

    it('si el gateway rechaza, deja la cuenta en PENDING con el error y relanza', async () => {
      gateway.createMerchant.mockRejectedValue(
        new PaymentGatewayError('rejected', 'RUT inválido'),
      );
      prisma.paymentAccount.upsert.mockResolvedValue({});

      await expect(
        service.onboard('therapist-1', ONBOARD_INPUT),
      ).rejects.toThrow();

      expect(prisma.paymentAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: 'PENDING' }) as unknown,
          update: expect.objectContaining({ status: 'PENDING' }) as unknown,
        }),
      );
    });
  });

  describe('status', () => {
    it('nunca incluye el campo credentialEncrypted en la respuesta', async () => {
      prisma.paymentAccount.findUnique.mockResolvedValue({
        therapistId: 'therapist-1',
        status: 'CONNECTED',
        merchantId: 'flow-merchant-1',
        connectedAt: new Date(),
        lastError: null,
        credentialEncrypted: Buffer.from('secret-bytes'),
      });

      const result = await service.status('therapist-1');

      expect(result).not.toHaveProperty('credentialEncrypted');
      expect(result.status).toBe('CONNECTED');
    });

    it('sin cuenta existente devuelve PENDING por default', async () => {
      prisma.paymentAccount.findUnique.mockResolvedValue(null);

      const result = await service.status('therapist-2');

      expect(result.status).toBe('PENDING');
      expect(result.merchantId).toBeNull();
    });
  });

  describe('disconnect', () => {
    it('desconecta una cuenta CONNECTED existente', async () => {
      prisma.paymentAccount.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.disconnect('therapist-1');

      expect(result.status).toBe('DISCONNECTED');
      expect(prisma.paymentAccount.updateMany).toHaveBeenCalledWith({
        where: { therapistId: 'therapist-1', status: 'CONNECTED' },
        data: expect.objectContaining({ status: 'DISCONNECTED' }) as unknown,
      });
    });

    it('lanza NotFoundException si no hay cuenta CONNECTED (uniforme: no existe o ya estaba desconectada)', async () => {
      prisma.paymentAccount.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.disconnect('therapist-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
