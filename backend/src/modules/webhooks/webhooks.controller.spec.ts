import {
  NotImplementedException,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

function buildRequest(rawBody?: Buffer): RawBodyRequest<Request> {
  return { rawBody } as unknown as RawBodyRequest<Request>;
}

describe('WebhooksController.handleResendWebhook', () => {
  let service: {
    isConfigured: jest.Mock;
    verifySignature: jest.Mock;
    handleEvent: jest.Mock;
  };
  let controller: WebhooksController;

  beforeEach(() => {
    service = {
      isConfigured: jest.fn().mockReturnValue(true),
      verifySignature: jest.fn().mockReturnValue(true),
      handleEvent: jest.fn().mockResolvedValue(undefined),
    };
    controller = new WebhooksController(service as unknown as WebhooksService);
  });

  it('lanza NotImplementedException (501) si RESEND_WEBHOOK_SECRET no está configurada, sin intentar verificar la firma', async () => {
    service.isConfigured.mockReturnValue(false);

    await expect(
      controller.handleResendWebhook(
        buildRequest(Buffer.from('{}')),
        'id-1',
        '123',
        'v1,sig',
        { type: 'email.delivered', data: { email_id: 'e-1' } },
      ),
    ).rejects.toThrow(NotImplementedException);
    expect(service.verifySignature).not.toHaveBeenCalled();
  });

  it('lanza UnauthorizedException (401) si la firma es inválida', async () => {
    service.verifySignature.mockReturnValue(false);

    await expect(
      controller.handleResendWebhook(
        buildRequest(Buffer.from('{}')),
        'id-1',
        '123',
        'v1,bad-sig',
        { type: 'email.delivered', data: { email_id: 'e-1' } },
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(service.handleEvent).not.toHaveBeenCalled();
  });

  it('lanza UnauthorizedException (401) si no hay rawBody disponible para verificar', async () => {
    await expect(
      controller.handleResendWebhook(
        buildRequest(undefined),
        'id-1',
        '123',
        'v1,sig',
        { type: 'email.delivered', data: { email_id: 'e-1' } },
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(service.verifySignature).not.toHaveBeenCalled();
  });

  it('delega el payload en handleEvent y responde { received: true } con firma válida', async () => {
    const body = { type: 'email.delivered', data: { email_id: 'e-1' } };

    const result = await controller.handleResendWebhook(
      buildRequest(Buffer.from(JSON.stringify(body))),
      'id-1',
      '123',
      'v1,sig',
      body,
    );

    expect(service.handleEvent).toHaveBeenCalledWith(body);
    expect(result).toEqual({ received: true });
  });
});
