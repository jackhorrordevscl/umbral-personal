import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsService } from './payments.service';
import { PaymentAccountService } from './payment-account.service';
import { PaymentsController } from './payments.controller';
import { PaymentGatewayClient } from './payment-gateway.client';
import { FlowPaymentGatewayClient } from './flow-gateway.client';
import { PaymentCredentialCryptoService } from './payment-credential-crypto.service';

// design.md "File Changes": imports ConfigModule (flag/env), MailModule
// (sendPaymentLinkEmail/sendLatePaymentEmail, PR 3) and NotificationsModule
// (PAYMENT_LATE, PR 2/3); exports PaymentsService. It imports neither
// consultations nor patients -- ConsultationsModule imports this module, not
// the other way around, so there's no cycle (same criterion as
// CalendarIntegrationModule).
//
// T4.5: PaymentGatewayClient's binding moves from
// UnconfiguredPaymentGatewayClient (PR 1, rejected every call) to
// FlowPaymentGatewayClient -- PaymentsService's shape doesn't change (design.md
// "One PaymentGatewayClient port"). FlowPaymentGatewayClient doesn't throw in
// its own constructor if FLOW_API_KEY/FLOW_SECRET_KEY are missing (unlike
// GoogleTokenCryptoService/DocumentEncryptionService, which do so in
// onModuleInit) -- it only rejects on the first method invoked, with
// PaymentGatewayError('credentials'), exactly the same contract
// UnconfiguredPaymentGatewayClient had. This is intentional: AppModule's boot
// (and that of any test importing AppModule) must not fail in
// environments without real Flow credentials (dev/CI/e2e), same as
// CalendarOauthService/MailService without their own credentials.
@Module({
  imports: [ConfigModule, MailModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentAccountService,
    PaymentCredentialCryptoService,
    {
      provide: PaymentGatewayClient,
      useClass: FlowPaymentGatewayClient,
    },
  ],
  exports: [PaymentsService, PaymentAccountService],
})
export class PaymentsModule {}
