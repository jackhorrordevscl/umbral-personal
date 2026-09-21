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
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ThrottlerGuard, SkipThrottle } from '@nestjs/throttler';
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

// Issue #133: throttlers ajenos que POST /confirm y GET|POST /return deben
// saltear -- los de AuthModule/ProfileModule más el otro nombre propio de
// este módulo, mismo criterio que FOREIGN_THROTTLER_NAMES en
// public-scheduling.controller.ts (ThrottlerModule es @Global(), así que
// cualquier throttler nombrado en cualquier módulo aplica acá salvo que se
// saltee explícitamente).
const PAYMENT_CONFIRM_SKIP = {
  login: true,
  'mfa-verify': true,
  signup: true,
  'mfa-setup': true,
  'password-change': true,
  'verify-email': true,
  'resend-verification': true,
  'password-reset': true,
  'mfa-recover': true,
  'public-availability': true,
  'public-booking': true,
  'profile-update': true,
  'email-change-confirm': true,
  'payment-return': true,
} as const;

const PAYMENT_RETURN_SKIP = {
  login: true,
  'mfa-verify': true,
  signup: true,
  'mfa-setup': true,
  'password-change': true,
  'verify-email': true,
  'resend-verification': true,
  'password-reset': true,
  'mfa-recover': true,
  'public-availability': true,
  'public-booking': true,
  'profile-update': true,
  'email-change-confirm': true,
  'payment-confirm': true,
} as const;

// design.md "REST" table + sequence "Connect account — after": POST
// /account/validate is the wizard's paste step (no write, task 3.1/3.2) and
// POST /account is the confirmation step (re-validates, then persists).
// Every account route (GET/POST/POST validate/DELETE) and PATCH /:groupId
// stays scoped to the authenticated therapist (@CurrentUser(), never a
// route :id) -- POST /confirm and GET|POST /return are the module's ONLY
// public routes (same criterion as CalendarIntegrationController.callback:
// no @UseGuards at the controller level, each protected route declares it
// individually).
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

  // Manual resend button next to "Copiar link de pago" (ConsultationsPage):
  // same ownership gate as updateAmount, same uniform 404 for a groupId that
  // doesn't belong to this therapist.
  @UseGuards(JwtAuthGuard)
  @Post(':groupId/resend-link')
  async resendLink(
    @Param('groupId') groupId: string,
    @CurrentUser() user: RequestUser,
  ) {
    await this.paymentsService.assertOwnership(groupId, user.id);
    return this.paymentsService.resendPaymentLink(groupId);
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
  // Issue #133: sin JwtAuthGuard (es un webhook), pero eso no la eximía de
  // rate limiting -- throttler propio ('payment-confirm', ver
  // buildPaymentsThrottlerOptions en payments.module.ts). @SkipThrottle
  // saltea TODOS los throttlers ajenos (los de AuthModule/ProfileModule más
  // 'payment-return', la otra ruta pública de este módulo): ThrottlerModule
  // es @Global(), mismo criterio que public-scheduling.controller.ts.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle(PAYMENT_CONFIRM_SKIP)
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

  // Bug fix: Flow's redirect back to the PATIENT after the hosted checkout
  // is a browser-submitted POST (confirmed against a real sandbox run, not
  // documented in Flow's public API docs) -- a static frontend SPA route has
  // no server-side handler for that, and returnUrl used to point straight at
  // one anyway (PAYMENT_RETURN_PATH's header comment). This route is public
  // (same tier as /confirm) because it never reads or mutates Payment state,
  // only resolves where to bounce the browser -- GET is kept alongside POST
  // as a safety net in case Flow ever redirects that way instead.
  // Issue #133: redirect del browser del paciente, también público -- mismo
  // criterio de throttling que confirm arriba, pero con su propio throttler
  // nombrado ('payment-return') para no compartir presupuesto con el
  // webhook server-to-server. GET y POST comparten el mismo nombre: son el
  // mismo caso de uso (safety net de método HTTP, ver el comentario sobre
  // returnFromGatewayPost/Get más abajo), no dos flujos distintos.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle(PAYMENT_RETURN_SKIP)
  @Post('return')
  returnFromGatewayPost(
    @Body('token') token: string | undefined,
    @Res() res: Response,
  ) {
    res.redirect(302, this.paymentsService.resolveReturnRedirectUrl(token));
  }

  @UseGuards(ThrottlerGuard)
  @SkipThrottle(PAYMENT_RETURN_SKIP)
  @Get('return')
  returnFromGatewayGet(
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ) {
    res.redirect(302, this.paymentsService.resolveReturnRedirectUrl(token));
  }
}
