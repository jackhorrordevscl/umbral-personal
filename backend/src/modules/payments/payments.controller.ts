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
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator';
import { ValidateCredentialsDto } from './dto/validate-credentials.dto';
import { ConnectAccountDto } from './dto/connect-account.dto';
import { UpdatePaymentAmountDto } from './dto/update-payment-amount.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';

const CONFIRM_SIGNATURE_ERROR = 'Firma de confirmación inválida.';

// design.md "REST" table + sequence "Connect account — after": POST
// /account/validate is the wizard's paste step (no write, task 3.1/3.2) and
// POST /account is the confirmation step (re-validates, then persists).
// Every account route (GET/POST/POST validate/DELETE) and PATCH /:groupId
// stays scoped to the authenticated therapist (@CurrentUser(), never a
// route :id) -- POST /confirm remains the module's ONLY public route (same
// criterion as CalendarIntegrationController.callback: no @UseGuards at the
// controller level, each protected route declares it individually).
@Controller('payments')
export class PaymentsController {
  constructor(
    private paymentsService: PaymentsService,
    private paymentAccountService: PaymentAccountService,
    private gatewayRegistry: PaymentGatewayRegistry,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('account')
  getAccount(@CurrentUser() user: RequestUser) {
    return this.paymentAccountService.status(user.id);
  }

  // spec "Guided Connection Wizard With Pre-Persistence Validation": the
  // paste step -- validates live against Flow and returns
  // { accountLabel?, keyFingerprint } with NO write on success or failure
  // (design.md sequence "Connect account — after", step 1).
  @UseGuards(JwtAuthGuard)
  @Post('account/validate')
  validateAccount(@Body() dto: ValidateCredentialsDto) {
    return this.paymentAccountService.validate(dto);
  }

  // The confirmation step -- re-validates independently of the earlier
  // /account/validate call, then encrypts and persists only on a
  // Flow-confirmed pair (design.md sequence "Connect account — after",
  // step 2).
  @UseGuards(JwtAuthGuard)
  @Post('account')
  connectAccount(
    @Body() dto: ConnectAccountDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.paymentAccountService.connect(user.id, dto);
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

  // T5.6/T7.9/T7.10 + design.md "Webhook — after": no JwtAuthGuard on
  // purpose -- Flow makes a server-to-server POST with no Authorization
  // header at all. Flow signs callbacks with the *owning merchant's* own
  // secret (there is no global secret anymore), so the credentials must be
  // resolved from the payment's owning therapist BEFORE the signature can
  // even be checked. That lookup is read-only (findByToken never mutates)
  // and precedes decryption: an unknown token or a disconnected/reconnect-
  // required owning account both fail with the same uniform 400 as an
  // invalid signature, without ever calling
  // paymentsService.confirm (the only path to a Prisma write) --
  // design.md's preserved invariant: "no state is mutated and no mail is
  // sent before the signature verifies".
  @Post('confirm')
  @HttpCode(200)
  async confirm(@Body() dto: ConfirmPaymentDto) {
    const payment = await this.paymentsService.findByToken(dto.token);
    if (!payment) {
      throw new BadRequestException(CONFIRM_SIGNATURE_ERROR);
    }

    const context = await this.paymentAccountService.resolveGatewayContext(
      payment.therapistId,
    );
    if (!context) {
      throw new BadRequestException(CONFIRM_SIGNATURE_ERROR);
    }

    const isValid = this.gatewayRegistry
      .get(context.provider)
      .verifyCallbackSignature(context.credentials, {
        token: dto.token,
        s: dto.s,
      });
    if (!isValid) {
      throw new BadRequestException(CONFIRM_SIGNATURE_ERROR);
    }

    await this.paymentsService.confirm(dto.token);
    return { received: true };
  }
}
