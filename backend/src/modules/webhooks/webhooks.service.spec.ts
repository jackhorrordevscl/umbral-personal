import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../../prisma/prisma.service';

// issue #163: secreto de prueba de baja entropía (todo ceros en base64) a
// propósito -- un valor con pinta de secreto real (aunque inventado) hacía
// que GitGuardian lo marcara como posible fuga en el PR #166. WebhooksService
// reimplementa la verificación del esquema Standard Webhooks con Node
// `crypto` (ver el comentario en webhooks.service.ts sobre por qué no se
// importa el paquete npm `svix` en runtime -- es ESM-only e incompatible con
// Jest/ts-jest en modo CommonJS); este helper firma el payload con el mismo
// algoritmo, independiente de la implementación bajo prueba.
const TEST_SECRET = 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function buildConfig(secret: string | undefined): ConfigService {
  return {
    get: jest.fn((key: string) =>
      key === 'RESEND_WEBHOOK_SECRET' ? secret : undefined,
    ),
  } as unknown as ConfigService;
}

function signPayload(payload: string) {
  const id = 'msg_test_1';
  const timestampSeconds = Math.floor(Date.now() / 1000);
  const secretBytes = Buffer.from(TEST_SECRET.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestampSeconds}.${payload}`;
  const signature = createHmac('sha256', secretBytes)
    .update(signedContent, 'utf-8')
    .digest('base64');

  return {
    'svix-id': id,
    'svix-timestamp': timestampSeconds.toString(),
    'svix-signature': `v1,${signature}`,
  };
}

describe('WebhooksService.isConfigured / verifySignature', () => {
  it('isConfigured es false y verifySignature siempre resuelve false sin RESEND_WEBHOOK_SECRET (degrada, no rompe)', () => {
    const service = new WebhooksService(
      buildConfig(undefined),
      {} as PrismaService,
    );

    expect(service.isConfigured()).toBe(false);
    const headers = signPayload('{}');
    expect(service.verifySignature(Buffer.from('{}'), headers)).toBe(false);
  });

  it('verifica como válida una firma generada con el mismo secret sobre el mismo body', () => {
    const service = new WebhooksService(
      buildConfig(TEST_SECRET),
      {} as PrismaService,
    );
    const payload = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'resend-1' },
    });
    const headers = signPayload(payload);

    expect(service.verifySignature(Buffer.from(payload), headers)).toBe(true);
  });

  it('rechaza la firma si el body fue alterado después de firmarlo', () => {
    const service = new WebhooksService(
      buildConfig(TEST_SECRET),
      {} as PrismaService,
    );
    const originalPayload = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'resend-1' },
    });
    const headers = signPayload(originalPayload);

    const tamperedPayload = JSON.stringify({
      type: 'email.opened',
      data: { email_id: 'resend-1' },
    });

    expect(service.verifySignature(Buffer.from(tamperedPayload), headers)).toBe(
      false,
    );
  });

  it('rechaza una firma que no corresponde al secret configurado', () => {
    const service = new WebhooksService(
      buildConfig(TEST_SECRET),
      {} as PrismaService,
    );
    const payload = JSON.stringify({ type: 'email.delivered' });

    expect(
      service.verifySignature(Buffer.from(payload), {
        'svix-id': 'msg_other',
        'svix-timestamp': Math.floor(Date.now() / 1000).toString(),
        'svix-signature': 'v1,not-a-real-signature',
      }),
    ).toBe(false);
  });
});

describe('WebhooksService.handleEvent', () => {
  let prisma: {
    reminderDispatch: { findFirst: jest.Mock; update: jest.Mock };
  };
  let service: WebhooksService;

  beforeEach(() => {
    prisma = {
      reminderDispatch: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    service = new WebhooksService(
      buildConfig(TEST_SECRET),
      prisma as unknown as PrismaService,
    );
  });

  it('actualiza deliveredAt para email.delivered cuando encuentra el dispatch sin valor previo', async () => {
    prisma.reminderDispatch.findFirst.mockResolvedValue({
      id: 'dispatch-1',
      deliveredAt: null,
    });

    await service.handleEvent({
      type: 'email.delivered',
      data: { email_id: 'resend-1' },
    });

    expect(prisma.reminderDispatch.findFirst).toHaveBeenCalledWith({
      where: { resendMessageId: 'resend-1' },
    });
    expect(prisma.reminderDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dispatch-1' },
        data: expect.objectContaining({
          deliveredAt: expect.any(Date) as Date,
        }) as { deliveredAt: Date },
      }),
    );
  });

  it('actualiza openedAt para email.opened cuando encuentra el dispatch sin valor previo', async () => {
    prisma.reminderDispatch.findFirst.mockResolvedValue({
      id: 'dispatch-2',
      openedAt: null,
    });

    await service.handleEvent({
      type: 'email.opened',
      data: { email_id: 'resend-2' },
    });

    expect(prisma.reminderDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dispatch-2' },
        data: expect.objectContaining({
          openedAt: expect.any(Date) as Date,
        }) as { openedAt: Date },
      }),
    );
  });

  it('ignora eventos de tipo desconocido (no-op, no busca ni actualiza)', async () => {
    await service.handleEvent({
      type: 'email.bounced',
      data: { email_id: 'resend-3' },
    });

    expect(prisma.reminderDispatch.findFirst).not.toHaveBeenCalled();
    expect(prisma.reminderDispatch.update).not.toHaveBeenCalled();
  });

  it('no falla si no encuentra ReminderDispatch para el email_id (no-op, evento fuera de alcance)', async () => {
    prisma.reminderDispatch.findFirst.mockResolvedValue(null);

    await expect(
      service.handleEvent({
        type: 'email.delivered',
        data: { email_id: 'resend-unknown' },
      }),
    ).resolves.toBeUndefined();
    expect(prisma.reminderDispatch.update).not.toHaveBeenCalled();
  });

  it('no pisa deliveredAt si ya tiene un valor (reenvío idempotente del mismo evento)', async () => {
    prisma.reminderDispatch.findFirst.mockResolvedValue({
      id: 'dispatch-4',
      deliveredAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.handleEvent({
      type: 'email.delivered',
      data: { email_id: 'resend-4' },
    });

    expect(prisma.reminderDispatch.update).not.toHaveBeenCalled();
  });

  it('no pisa openedAt si ya tiene un valor (reenvío idempotente del mismo evento)', async () => {
    prisma.reminderDispatch.findFirst.mockResolvedValue({
      id: 'dispatch-5',
      openedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await service.handleEvent({
      type: 'email.opened',
      data: { email_id: 'resend-5' },
    });

    expect(prisma.reminderDispatch.update).not.toHaveBeenCalled();
  });
});
