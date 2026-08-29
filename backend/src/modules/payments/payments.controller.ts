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

// design.md "REST" table: todas las rutas de cuenta (GET/POST/DELETE
// /account) y PATCH /:groupId quedan scoped al terapeuta autenticado
// (@CurrentUser(), nunca un :id de ruta) -- POST /confirm es la ÚNICA ruta
// pública del módulo (mismo criterio que
// CalendarIntegrationController.callback: sin @UseGuards a nivel de
// controller, cada ruta protegida lo declara individualmente).
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

  // T5.5/T7.7/T7.8: assertOwnership PRIMERO -- terapeuta B pidiendo el
  // groupId de terapeuta A recibe el mismo 404 uniforme que un groupId
  // inexistente, antes de que updateAmount llegue a tocar el cargo.
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

  // T5.6/T7.9/T7.10: sin JwtAuthGuard a propósito -- Flow hace un POST
  // servidor-a-servidor sin ningún header Authorization (design.md "The
  // confirmation callback is a signal, never a source of truth"). La
  // verificación de firma ocurre ACÁ, antes de cualquier llamada a
  // paymentsService.confirm (que es la única vía a Prisma) -- un body sin
  // firma válida nunca llega a leer ni escribir la base de datos.
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
