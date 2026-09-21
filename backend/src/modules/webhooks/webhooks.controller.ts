import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService, type ResendWebhookPayload } from './webhooks.service';

// issue #163: público a propósito -- sin JwtAuthGuard, Resend no manda
// credenciales de la app, solo la firma Svix (verificada en
// WebhooksService.verifySignature contra RESEND_WEBHOOK_SECRET). No hay
// @UseGuards en este controller ni un APP_GUARD global en app.module.ts, así
// que esta ruta queda pública por diseño.
@Controller('webhooks')
export class WebhooksController {
  constructor(private webhooksService: WebhooksService) {}

  @Post('resend')
  @HttpCode(HttpStatus.OK)
  async handleResendWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
    @Body() body: ResendWebhookPayload,
  ): Promise<{ received: true }> {
    // Sin RESEND_WEBHOOK_SECRET configurada, degrada a 501 sin intentar
    // verificar nada -- mismo criterio que MailService sin RESEND_API_KEY.
    if (!this.webhooksService.isConfigured()) {
      throw new NotImplementedException();
    }

    // req.rawBody requiere `rawBody: true` en NestFactory.create (ver
    // main.ts) -- Resend firma los bytes exactos del body, no el objeto ya
    // parseado por Express.
    const isValid =
      !!req.rawBody &&
      this.webhooksService.verifySignature(req.rawBody, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      });

    if (!isValid) {
      throw new UnauthorizedException();
    }

    await this.webhooksService.handleEvent(body);
    return { received: true };
  }
}
