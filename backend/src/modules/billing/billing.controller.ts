import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ConfirmPaymentDto } from '../payments/dto/confirm-payment.dto';
import {
  PAYMENT_CONFIRM_SKIP,
  PAYMENT_RETURN_SKIP,
} from '../payments/payments.controller';
import { BillingService } from './billing.service';

const CONFIRM_REJECTED_ERROR = 'Confirmación de pago rechazada.';

// Issue #611 (PR 2). checkout exige sesión; confirm y return son públicos a
// propósito (Flow y el navegador no llevan sesión) y reutilizan los throttlers
// nombrados de PaymentsModule, que ya existen y ya están salteados por el resto
// de los controladores.
@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(private readonly billingService: BillingService) {}

  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  checkout(@CurrentUser() user: RequestUser) {
    return this.billingService.createCheckout(user.id);
  }

  // Webhook de Flow: trae solo `token`. Nunca se confía en él; confirmByToken
  // vuelve a consultar getStatus con nuestras propias credenciales. Todo lo que
  // no sea un pago verificable devuelve el mismo 400 uniforme.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle(PAYMENT_CONFIRM_SKIP)
  @Post('confirm')
  @HttpCode(200)
  async confirm(@Body() dto: ConfirmPaymentDto) {
    let outcome: Awaited<ReturnType<BillingService['confirmByToken']>>;
    try {
      outcome = await this.billingService.confirmByToken(dto.token);
    } catch (err) {
      this.logger.warn(
        `Confirmación de suscripción rechazada: no se pudo verificar en Flow: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException(CONFIRM_REJECTED_ERROR);
    }
    if (outcome === 'unknown') {
      this.logger.warn(
        'Confirmación de suscripción rechazada: no existe un pago con ese token.',
      );
      throw new BadRequestException(CONFIRM_REJECTED_ERROR);
    }
    return { received: true };
  }

  // Flow devuelve al navegador con un POST; se redirige a la pantalla del
  // frontend. No lee ni muta nada. GET queda como red de seguridad.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle(PAYMENT_RETURN_SKIP)
  @Post('return')
  returnPost(@Res() res: Response) {
    res.redirect(302, this.billingService.frontendReturnUrl());
  }

  @UseGuards(ThrottlerGuard)
  @SkipThrottle(PAYMENT_RETURN_SKIP)
  @Get('return')
  returnGet(@Res() res: Response) {
    res.redirect(302, this.billingService.frontendReturnUrl());
  }
}
