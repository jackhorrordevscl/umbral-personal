import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hashInvitationCode } from '../auth/invitation-code.util';
import { SubscriptionsService } from './subscriptions.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-10T12:00:00Z');
const days = (d: number) => new Date(now.getTime() + d * DAY_MS);

describe('SubscriptionsService', () => {
  let tx: {
    $queryRaw: jest.Mock;
    subscriptionPayment: { findUnique: jest.Mock; updateMany: jest.Mock };
    subscription: {
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      upsert: jest.Mock;
    };
    promoCode: { findUnique: jest.Mock; updateMany: jest.Mock };
    promoRedemption: { create: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    user: { findUnique: jest.Mock };
    subscriptionGrant: { findUnique: jest.Mock };
  };
  let env: Record<string, string | undefined>;
  let service: SubscriptionsService;

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      subscriptionPayment: { findUnique: jest.fn(), updateMany: jest.fn() },
      subscription: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      promoCode: { findUnique: jest.fn(), updateMany: jest.fn() },
      promoRedemption: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      user: { findUnique: jest.fn() },
      subscriptionGrant: { findUnique: jest.fn() },
    };
    env = {};
    service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      { get: jest.fn((k: string) => env[k]) } as unknown as ConfigService,
    );
  });

  describe('getAccess', () => {
    it('busca la concesión por el email normalizado en minúsculas', async () => {
      prisma.user.findUnique.mockResolvedValue({
        email: ' Ana@Mail.COM ',
        subscription: null,
      });
      prisma.subscriptionGrant.findUnique.mockResolvedValue({
        expiresAt: null,
      });
      const r = await service.getAccess('u1', now);
      expect(prisma.subscriptionGrant.findUnique).toHaveBeenCalledWith({
        where: { email: 'ana@mail.com' },
        select: { expiresAt: true },
      });
      expect(r.state).toBe('EXEMPT');
    });

    it('usa currentPeriodEnd de la suscripción', async () => {
      prisma.user.findUnique.mockResolvedValue({
        email: 'a@b.cl',
        subscription: { currentPeriodEnd: days(3) },
      });
      prisma.subscriptionGrant.findUnique.mockResolvedValue(null);
      expect((await service.getAccess('u1', now)).state).toBe('ACTIVE');
    });

    it('un usuario inexistente queda en solo lectura', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      expect((await service.getAccess('x', now)).state).toBe('READ_ONLY');
    });
  });

  describe('applyPaidPeriod', () => {
    beforeEach(() => {
      tx.subscriptionPayment.findUnique.mockResolvedValue({
        id: 'p1',
        subscriptionId: 's1',
      });
    });

    it('suma 30 días desde el vencimiento vigente y bloquea la suscripción', async () => {
      tx.subscriptionPayment.updateMany.mockResolvedValue({ count: 1 });
      tx.subscription.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        currentPeriodEnd: days(5),
      });
      const end = await service.applyPaidPeriod('c1', 99, now);
      expect(end).toEqual(days(35));
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.subscriptionPayment.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', status: { not: 'PAID' } },
        data: { status: 'PAID', flowOrder: 99, paidAt: now },
      });
      expect(tx.subscription.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { currentPeriodEnd: days(35) },
      });
    });

    it('un pago ya aplicado no suma otra vez (webhook repetido)', async () => {
      tx.subscriptionPayment.updateMany.mockResolvedValue({ count: 0 });
      expect(await service.applyPaidPeriod('c1', 99, now)).toBeNull();
      expect(tx.subscription.update).not.toHaveBeenCalled();
    });

    it('rechaza un commerceOrder desconocido', async () => {
      tx.subscriptionPayment.findUnique.mockResolvedValue(null);
      await expect(
        service.applyPaidPeriod('zzz', 1, now),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('redeemPromoCode', () => {
    const promo = {
      id: 'pc1',
      maxRedemptions: 30,
      trialDays: 30,
      expiresAt: days(10),
    };

    it('canjea: incrementa con tope, registra el canje y crea la suscripción con el precio', async () => {
      tx.promoCode.findUnique.mockResolvedValue(promo);
      tx.promoCode.updateMany.mockResolvedValue({ count: 1 });
      const end = await service.redeemPromoCode(
        tx as unknown as Prisma.TransactionClient,
        'u1',
        'FLYER-1',
        now,
      );
      expect(tx.promoCode.findUnique).toHaveBeenCalledWith({
        where: { codeHash: hashInvitationCode('FLYER-1') },
      });
      expect(tx.promoCode.updateMany).toHaveBeenCalledWith({
        where: { id: 'pc1', redemptionCount: { lt: 30 } },
        data: { redemptionCount: { increment: 1 } },
      });
      expect(tx.promoRedemption.create).toHaveBeenCalledWith({
        data: { promoCodeId: 'pc1', userId: 'u1' },
      });
      expect(end).toEqual(days(30));
      expect(tx.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            priceClp: 6990,
            priceStartedAt: now,
          }) as unknown,
        }),
      );
    });

    it('toma el precio de SUBSCRIPTION_PRICE_CLP si es válido', async () => {
      env.SUBSCRIPTION_PRICE_CLP = '7990';
      tx.promoCode.findUnique.mockResolvedValue(promo);
      tx.promoCode.updateMany.mockResolvedValue({ count: 1 });
      await service.redeemPromoCode(
        tx as unknown as Prisma.TransactionClient,
        'u1',
        'X',
        now,
      );
      expect(tx.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ priceClp: 7990 }) as unknown,
        }),
      );
    });

    it.each([
      ['no existe', null],
      ['venció', { ...promo, expiresAt: days(-1) }],
    ])('rechaza un código que %s', async (_n, row) => {
      tx.promoCode.findUnique.mockResolvedValue(row);
      await expect(
        service.redeemPromoCode(
          tx as unknown as Prisma.TransactionClient,
          'u1',
          'X',
          now,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.promoRedemption.create).not.toHaveBeenCalled();
    });

    it('rechaza cuando el tope ya se alcanzó, sin registrar el canje', async () => {
      tx.promoCode.findUnique.mockResolvedValue(promo);
      tx.promoCode.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.redeemPromoCode(
          tx as unknown as Prisma.TransactionClient,
          'u1',
          'X',
          now,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.promoRedemption.create).not.toHaveBeenCalled();
      expect(tx.subscription.upsert).not.toHaveBeenCalled();
    });
  });
});
