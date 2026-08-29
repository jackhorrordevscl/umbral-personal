import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsService } from './payments.service';
import {
  PaymentGatewayClient,
  UnconfiguredPaymentGatewayClient,
} from './payment-gateway.client';

// design.md "File Changes": imports ConfigModule (flag/env), MailModule
// (sendPaymentLinkEmail/sendLatePaymentEmail, PR 3) y NotificationsModule
// (PAYMENT_LATE, PR 2/3); exports PaymentsService. No importa
// consultations ni patients -- ConsultationsModule importa este módulo, no
// al revés, para que no haya ciclo (mismo criterio que
// CalendarIntegrationModule).
//
// El binding de PaymentGatewayClient acá es UnconfiguredPaymentGatewayClient
// (PR 1) -- rechaza toda llamada con PaymentGatewayError('credentials').
// PR 2 (task 4.5) reemplaza este provider por FlowPaymentGatewayClient sin
// que PaymentsService cambie de forma.
@Module({
  imports: [ConfigModule, MailModule, NotificationsModule],
  providers: [
    PaymentsService,
    {
      provide: PaymentGatewayClient,
      useClass: UnconfiguredPaymentGatewayClient,
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
