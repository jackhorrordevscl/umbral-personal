import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentAccountService } from './payment-account.service';
import { PaymentGatewayClient } from './payment-gateway.client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';
import { OnboardPaymentAccountDto } from './dto/onboard-payment-account.dto';
import { UpdatePaymentAmountDto } from './dto/update-payment-amount.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';

// design.md "REST" table: every account route (GET/POST/DELETE
// /account) and PATCH /:groupId is scoped to the authenticated therapist
// (@CurrentUser(), never a route :id) -- POST /confirm is the module's ONLY
// public route (same criterion as
// CalendarIntegrationController.callback: no @UseGuards at the
// controller level, each protected route declares it individually).
@Controller('payments')
export class PaymentsController {
  constructor(
    private paymentsService: PaymentsService,
    private paymentAccountService: PaymentAccountService,
    private gateway: PaymentGatewayClient,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('account')
  getAccount(@CurrentUser() user: RequestUser) {
    return this.paymentAccountService.status(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('account')
  onboard(
    @Body() dto: OnboardPaymentAccountDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.paymentAccountService.onboard(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('account')
  disconnect(@CurrentUser() user: RequestUser) {
    return this.paymentAccountService.disconnect(user.id);
  }

  // T5.5/T7.7/T7.8: assertOwnership FIRST -- therapist B requesting
  // therapist A's groupId gets the same uniform 404 as a non-existent
  // groupId, before updateAmount ever gets to touch the charge.
  @UseGuards(JwtAuthGuard)
  @Patch(':groupId')
  async updateAmount(
    @Param('groupId') groupId: string,
    @Body() dto: UpdatePaymentAmountDto,
    @CurrentUser() user: RequestUser,
  ) {
    await this.paymentsService.assertOwnership(groupId, user.id);
    return this.paymentsService.updateAmount(groupId, dto.amount);
  }

  // T5.6/T7.9/T7.10: no JwtAuthGuard on purpose -- Flow makes a
  // server-to-server POST with no Authorization header at all (design.md
  // "The confirmation callback is a signal, never a source of truth"). The
  // signature check happens HERE, before any call to
  // paymentsService.confirm (which is the only path to Prisma) -- a body
  // without a valid signature never reaches a database read or write.
  @Post('confirm')
  @HttpCode(200)
  async confirm(@Body() dto: ConfirmPaymentDto) {
    const isValid = this.gateway.verifyCallbackSignature({
      token: dto.token,
      s: dto.s,
    });
    if (!isValid) {
      throw new BadRequestException('Firma de confirmación inválida.');
    }

    await this.paymentsService.confirm(dto.token);
    return { received: true };
  }
}
