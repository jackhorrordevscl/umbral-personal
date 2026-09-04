import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsService } from './payments.service';
import { PaymentAccountService } from './payment-account.service';
import { PaymentsController } from './payments.controller';
import { PaymentGatewayClient } from './payment-gateway.client';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { FlowPaymentGatewayClient } from './flow-gateway.client';
import { PaymentCredentialCryptoService } from './payment-credential-crypto.service';

// design.md "File Changes": imports ConfigModule (flag/env), MailModule
// (sendPaymentLinkEmail/sendLatePaymentEmail, PR 3) and NotificationsModule
// (PAYMENT_LATE, PR 2/3); exports PaymentsService and PaymentAccountService.
// It imports neither consultations nor patients -- ConsultationsModule
// imports this module, not the other way around, so there's no cycle (same
// criterion as CalendarIntegrationModule).
//
// sdd/payments-multigateway-redesign task 3.4 (design.md
// "PaymentGatewayRegistry (new)"): FlowPaymentGatewayClient is registered as
// its own provider (so the registry factory can inject the concrete
// instance) AND bound to the abstract PaymentGatewayClient token via
// useExisting (same singleton, not a second instance) -- kept only for
// symmetry with the port and any code that still depends on the token
// directly. PaymentGatewayRegistry is built from the list of every
// registered adapter; proposal.md "Extensible gateway selection" -- a second
// provider is a new adapter class plus one more entry in this array,
// nothing else in the module changes. FlowPaymentGatewayClient doesn't
// throw in its own constructor when no credentials are configured (unlike
// GoogleTokenCryptoService/DocumentEncryptionService, which validate in
// onModuleInit) -- every call now takes its credentials as an explicit
// argument (design.md "Port contract": stateless), so there is no ambient
// config left to be missing at boot. AppModule's boot (and that of any test
// importing AppModule) must not fail in environments without real Flow
// credentials (dev/CI/e2e), same as CalendarOauthService/MailService
// without their own credentials.
@Module({
  imports: [ConfigModule, MailModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentAccountService,
    PaymentCredentialCryptoService,
    FlowPaymentGatewayClient,
    {
      provide: PaymentGatewayClient,
      useExisting: FlowPaymentGatewayClient,
    },
    {
      provide: PaymentGatewayRegistry,
      useFactory: (flow: FlowPaymentGatewayClient) =>
        new PaymentGatewayRegistry([flow]),
      inject: [FlowPaymentGatewayClient],
    },
  ],
  exports: [PaymentsService, PaymentAccountService],
})
export class PaymentsModule {}
