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
// (sendPaymentLinkEmail/sendLatePaymentEmail, PR 3) y NotificationsModule
// (PAYMENT_LATE, PR 2/3); exports PaymentsService. No importa
// consultations ni patients -- ConsultationsModule importa este módulo, no
// al revés, para que no haya ciclo (mismo criterio que
// CalendarIntegrationModule).
//
// T4.5: el binding de PaymentGatewayClient pasa de
// UnconfiguredPaymentGatewayClient (PR 1, rechazaba toda llamada) a
// FlowPaymentGatewayClient -- PaymentsService no cambia de forma (design.md
// "One PaymentGatewayClient port"). FlowPaymentGatewayClient no lanza en su
// propio constructor si faltan FLOW_API_KEY/FLOW_SECRET_KEY (a diferencia de
// GoogleTokenCryptoService/DocumentEncryptionService, que sí lo hacen en
// onModuleInit) -- rechaza recién al primer método invocado, con
// PaymentGatewayError('credentials'), exactamente el mismo contrato que
// UnconfiguredPaymentGatewayClient tenía. Esto es intencional: el boot de
// AppModule (y de cualquier test que importe AppModule) no debe fallar en
// entornos sin credenciales reales de Flow (dev/CI/e2e), igual que
// CalendarOauthService/MailService sin sus propias credenciales.
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
