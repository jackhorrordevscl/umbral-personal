import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentAccountStatus, PaymentProvider } from '@prisma/client';
import { PaymentAccountService } from './payment-account.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GatewayCredentials,
  PaymentGatewayError,
} from './payment-gateway.client';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { PaymentCredentialCryptoService } from './payment-credential-crypto.service';

// sdd/payments-multigateway-redesign PR 2 (tasks 2.2-2.5): same manual-mock
// pattern as payment-gateway.registry.spec.ts/flow-gateway.client.spec.ts --
// PaymentAccountService now depends on PaymentGatewayRegistry (design.md
// "Sequences", `registry.get(FLOW).validateCredentials(creds)`) instead of a
// single PaymentGatewayClient, so the mock exposes `.get()` returning a stub
// adapter with `validateCredentials`.
describe('PaymentAccountService', () => {
  let service: PaymentAccountService;
  let prisma: {
    paymentAccount: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let registry: { get: jest.Mock };
  let gatewayClient: { validateCredentials: jest.Mock };
  let crypto: { encrypt: jest.Mock; decrypt: jest.Mock };

  // Well-formed per the service's best-effort CREDENTIAL_FORMAT gate
  // (16-128 chars, alphanumeric/underscore/dash).
  const VALID_API_KEY = 'a'.repeat(32);
  const VALID_SECRET_KEY = 'b'.repeat(32);

  beforeEach(() => {
    prisma = {
      paymentAccount: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    gatewayClient = { validateCredentials: jest.fn() };
    registry = { get: jest.fn().mockReturnValue(gatewayClient) };
    crypto = {
      encrypt: jest.fn().mockReturnValue(Buffer.from('encrypted-blob')),
      decrypt: jest.fn(),
    };

    service = new PaymentAccountService(
      prisma as unknown as PrismaService,
      registry as unknown as PaymentGatewayRegistry,
      crypto as unknown as PaymentCredentialCryptoService,
    );
  });

  describe('validate', () => {
    // task 2.3 + spec "Malformed credentials are rejected before calling
    // Flow": the field-level format check runs BEFORE the registry is ever
    // touched, and validate() makes no Prisma call at all -- a rejected
    // validate() persists nothing by construction (there is no write path
    // in this method).
    it('rechaza un apiKey/secretKey mal formado sin llamar a Flow ni a Prisma', async () => {
      await expect(
        service.validate({ apiKey: '', secretKey: VALID_SECRET_KEY }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(registry.get).not.toHaveBeenCalled();
      expect(gatewayClient.validateCredentials).not.toHaveBeenCalled();
      expect(prisma.paymentAccount.upsert).not.toHaveBeenCalled();
      expect(prisma.paymentAccount.updateMany).not.toHaveBeenCalled();
    });

    it('rechaza un secretKey demasiado corto sin llamar a Flow', async () => {
      await expect(
        service.validate({ apiKey: VALID_API_KEY, secretKey: 'short' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(registry.get).not.toHaveBeenCalled();
      expect(gatewayClient.validateCredentials).not.toHaveBeenCalled();
    });

    it('con credenciales bien formadas, delega en registry.get(provider).validateCredentials y no escribe nada', async () => {
      gatewayClient.validateCredentials.mockResolvedValue({
        keyFingerprint: 'fingerprint-1',
      });

      const result = await service.validate({
        apiKey: VALID_API_KEY,
        secretKey: VALID_SECRET_KEY,
      });

      expect(registry.get).toHaveBeenCalledWith(PaymentProvider.FLOW);
      expect(gatewayClient.validateCredentials).toHaveBeenCalledWith(
        expect.any(GatewayCredentials),
      );
      expect(result).toEqual({ keyFingerprint: 'fingerprint-1' });
      expect(prisma.paymentAccount.upsert).not.toHaveBeenCalled();
      expect(prisma.paymentAccount.updateMany).not.toHaveBeenCalled();
    });

    it('propaga el rechazo de Flow (credenciales bien formadas pero inválidas) sin persistir nada', async () => {
      gatewayClient.validateCredentials.mockRejectedValue(
        new PaymentGatewayError('credentials', 'apiKey/firma inválida'),
      );

      await expect(
        service.validate({
          apiKey: VALID_API_KEY,
          secretKey: VALID_SECRET_KEY,
        }),
      ).rejects.toBeInstanceOf(PaymentGatewayError);

      expect(prisma.paymentAccount.upsert).not.toHaveBeenCalled();
    });
  });

  describe('connect', () => {
    // task 2.3 (mirrored for connect): same format gate applies before
    // connect() ever calls the gateway or Prisma.
    it('rechaza credenciales mal formadas sin llamar a Flow ni a Prisma', async () => {
      await expect(
        service.connect('therapist-1', {
          apiKey: 'not-hex-!!',
          secretKey: VALID_SECRET_KEY,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(registry.get).not.toHaveBeenCalled();
      expect(gatewayClient.validateCredentials).not.toHaveBeenCalled();
      expect(prisma.paymentAccount.upsert).not.toHaveBeenCalled();
    });

    // task 2.5 + spec "Abandoning the Wizard Persists Nothing" /
    // "Flow rejects well-formed but invalid credentials": on a live-probe
    // failure connect() writes ONLY lastError (never flips status, never
    // encrypts/persists a credential blob) -- the v2 upsert path is
    // reached only after Flow confirms the pair.
    it('si Flow rechaza la re-validación, escribe solo lastError y no persiste ningún blob', async () => {
      gatewayClient.validateCredentials.mockRejectedValue(
        new PaymentGatewayError('credentials', 'apiKey/firma inválida'),
      );
      prisma.paymentAccount.upsert.mockResolvedValue({});

      await expect(
        service.connect('therapist-1', {
          apiKey: VALID_API_KEY,
          secretKey: VALID_SECRET_KEY,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.paymentAccount.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.paymentAccount.upsert).toHaveBeenCalledWith({
        where: { therapistId: 'therapist-1' },
        create: expect.objectContaining({
          status: PaymentAccountStatus.PENDING,
        }) as unknown,
        update: { lastError: expect.any(String) as unknown },
      });
      expect(crypto.encrypt).not.toHaveBeenCalled();
    });

    it('tras una validación exitosa, cifra {apiKey,secretKey} y persiste credentialVersion=2 + CONNECTED', async () => {
      gatewayClient.validateCredentials.mockResolvedValue({
        keyFingerprint: 'fingerprint-1',
      });
      prisma.paymentAccount.upsert.mockResolvedValue({
        therapistId: 'therapist-1',
        provider: PaymentProvider.FLOW,
        status: PaymentAccountStatus.CONNECTED,
        displayName: null,
        keyFingerprint: 'fingerprint-1',
        connectedAt: new Date('2026-09-04T00:00:00.000Z'),
        lastError: null,
      });

      const result = await service.connect('therapist-1', {
        apiKey: VALID_API_KEY,
        secretKey: VALID_SECRET_KEY,
        displayName: 'Mi consulta',
      });

      expect(gatewayClient.validateCredentials).toHaveBeenCalledTimes(1);
      expect(crypto.encrypt).toHaveBeenCalledTimes(1);
      const [plaintext] = crypto.encrypt.mock.calls[0] as [Buffer];
      expect(JSON.parse(plaintext.toString('utf-8'))).toEqual({
        apiKey: VALID_API_KEY,
        secretKey: VALID_SECRET_KEY,
      });

      expect(prisma.paymentAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { therapistId: 'therapist-1' },
          create: expect.objectContaining({
            status: PaymentAccountStatus.CONNECTED,
            credentialVersion: 2,
            keyFingerprint: 'fingerprint-1',
          }) as unknown,
          update: expect.objectContaining({
            status: PaymentAccountStatus.CONNECTED,
            credentialVersion: 2,
            keyFingerprint: 'fingerprint-1',
          }) as unknown,
        }),
      );
      expect(result.status).toBe(PaymentAccountStatus.CONNECTED);
      expect(result).not.toHaveProperty('credentialEncrypted');
    });

    it('usa el accountLabel de Flow por sobre el displayName tipeado por el terapeuta', async () => {
      gatewayClient.validateCredentials.mockResolvedValue({
        accountLabel: 'Comercio Flow S.A.',
        keyFingerprint: 'fingerprint-1',
      });
      prisma.paymentAccount.upsert.mockResolvedValue({});

      await service.connect('therapist-1', {
        apiKey: VALID_API_KEY,
        secretKey: VALID_SECRET_KEY,
        displayName: 'Mi consulta',
      });

      expect(prisma.paymentAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            displayName: 'Comercio Flow S.A.',
          }) as unknown,
        }),
      );
    });
  });

  describe('resolveGatewayContext', () => {
    // task 2.4: null for every non-CONNECTED status, and for a missing
    // account entirely -- design.md Decision 2's "no order, charge stays
    // PENDING" degradation path.
    it.each([
      PaymentAccountStatus.PENDING,
      PaymentAccountStatus.DISCONNECTED,
      PaymentAccountStatus.RECONNECT_REQUIRED,
    ])('devuelve null cuando el status es %s', async (status) => {
      prisma.paymentAccount.findUnique.mockResolvedValue({
        therapistId: 'therapist-1',
        status,
        provider: PaymentProvider.FLOW,
        credentialVersion: 2,
        credentialEncrypted: Buffer.from('cipher'),
      });

      const result = await service.resolveGatewayContext('therapist-1');

      expect(result).toBeNull();
      expect(crypto.decrypt).not.toHaveBeenCalled();
    });

    it('devuelve null cuando no existe ninguna cuenta', async () => {
      prisma.paymentAccount.findUnique.mockResolvedValue(null);

      const result = await service.resolveGatewayContext('therapist-1');

      expect(result).toBeNull();
      expect(crypto.decrypt).not.toHaveBeenCalled();
    });

    it('devuelve null para una cuenta CONNECTED con blob legado (credentialVersion=1), sin intentar decodificarlo como v2', async () => {
      prisma.paymentAccount.findUnique.mockResolvedValue({
        therapistId: 'therapist-1',
        status: PaymentAccountStatus.CONNECTED,
        provider: PaymentProvider.FLOW,
        credentialVersion: 1,
        credentialEncrypted: Buffer.from('legacy-merchant-id-blob'),
      });

      const result = await service.resolveGatewayContext('therapist-1');

      expect(result).toBeNull();
      expect(crypto.decrypt).not.toHaveBeenCalled();
    });

    it('descifra y devuelve un GatewayContext para una cuenta CONNECTED con credentialVersion=2', async () => {
      prisma.paymentAccount.findUnique.mockResolvedValue({
        therapistId: 'therapist-1',
        status: PaymentAccountStatus.CONNECTED,
        provider: PaymentProvider.FLOW,
        credentialVersion: 2,
        credentialEncrypted: Buffer.from('cipher'),
      });
      crypto.decrypt.mockReturnValue(
        Buffer.from(
          JSON.stringify({
            apiKey: VALID_API_KEY,
            secretKey: VALID_SECRET_KEY,
          }),
        ),
      );

      const result = await service.resolveGatewayContext('therapist-1');

      expect(crypto.decrypt).toHaveBeenCalledTimes(1);
      expect(result?.provider).toBe(PaymentProvider.FLOW);
      expect(result?.credentials).toBeInstanceOf(GatewayCredentials);
      expect(result?.credentials.apiKey).toBe(VALID_API_KEY);
      expect(result?.credentials.secretKey).toBe(VALID_SECRET_KEY);
    });
  });

  describe('status', () => {
    it('nunca incluye credentialEncrypted ni merchantId en la respuesta', async () => {
      prisma.paymentAccount.findUnique.mockResolvedValue({
        therapistId: 'therapist-1',
        status: PaymentAccountStatus.CONNECTED,
        provider: PaymentProvider.FLOW,
        displayName: 'Mi consulta',
        keyFingerprint: 'fingerprint-1',
        connectedAt: new Date(),
        lastError: null,
        merchantId: 'legacy-merchant-1',
        credentialEncrypted: Buffer.from('secret-bytes'),
      });

      const result = await service.status('therapist-1');

      expect(result).not.toHaveProperty('credentialEncrypted');
      expect(result).not.toHaveProperty('merchantId');
      expect(result.status).toBe(PaymentAccountStatus.CONNECTED);
    });

    it('sin cuenta existente devuelve PENDING por default', async () => {
      prisma.paymentAccount.findUnique.mockResolvedValue(null);

      const result = await service.status('therapist-2');

      expect(result.status).toBe(PaymentAccountStatus.PENDING);
      expect(result.displayName).toBeNull();
    });
  });

  describe('disconnect', () => {
    it('desconecta una cuenta CONNECTED existente', async () => {
      prisma.paymentAccount.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.disconnect('therapist-1');

      expect(result.status).toBe(PaymentAccountStatus.DISCONNECTED);
      expect(prisma.paymentAccount.updateMany).toHaveBeenCalledWith({
        where: {
          therapistId: 'therapist-1',
          status: PaymentAccountStatus.CONNECTED,
        },
        data: expect.objectContaining({
          status: PaymentAccountStatus.DISCONNECTED,
        }) as unknown,
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
