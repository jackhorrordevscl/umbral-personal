import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerModuleOptions } from '@nestjs/throttler';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsService } from './payments.service';
import { PaymentAccountService } from './payment-account.service';
import { PaymentsController } from './payments.controller';
import { PaymentGatewayClient } from './payment-gateway.client';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { FlowPaymentGatewayClient } from './flow-gateway.client';
import { PaymentCredentialCryptoService } from './payment-credential-crypto.service';
import { AuthModule, getLoginTracker } from '../auth/auth.module';

/**
 * Issue #133: /payments/confirm (webhook de Flow) y /payments/return
 * (redirect del browser del paciente) son públicas a propósito (sin
 * JwtAuthGuard, ver el comentario de PaymentsController) pero no tenían
 * ningún ThrottlerGuard, a diferencia de auth/profile/public-scheduling.
 * Mismo patrón que ProfileModule (AuthModule no exporta su propio
 * ThrottlerModule.forRootAsync): dos throttlers nombrados, tracker
 * IP-based reusando getLoginTracker de AuthModule -- ninguna de las dos
 * rutas corre detrás de JwtAuthGuard, así que no hay req.user.id
 * disponible como en ProfileModule.
 *
 * - 'payment-confirm': POST /payments/confirm, tráfico server-to-server
 *   legítimo de un único servidor (Flow) -- límite más generoso.
 * - 'payment-return': GET|POST /payments/return, redirect del browser del
 *   paciente -- límite más conservador, mismo orden de magnitud que
 *   public-booking.
 */
const throttlerLogger = new Logger('PaymentsThrottlerConfig');

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  varName: string,
): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  throttlerLogger.warn(
    `${varName}="${raw}" no es un entero positivo válido, usando el default (${fallback}).`,
  );
  return fallback;
}

export function buildPaymentsThrottlerOptions(
  config: ConfigService,
): ThrottlerModuleOptions {
  const isTest = config.get<string>('NODE_ENV') === 'test';

  const paymentConfirmLimit = parsePositiveInt(
    config.get<string>('PAYMENT_CONFIRM_THROTTLE_LIMIT'),
    isTest ? 1000 : 30,
    'PAYMENT_CONFIRM_THROTTLE_LIMIT',
  );
  const paymentConfirmTtl = parsePositiveInt(
    config.get<string>('PAYMENT_CONFIRM_THROTTLE_TTL_MS'),
    60000,
    'PAYMENT_CONFIRM_THROTTLE_TTL_MS',
  );

  const paymentReturnLimit = parsePositiveInt(
    config.get<string>('PAYMENT_RETURN_THROTTLE_LIMIT'),
    isTest ? 1000 : 20,
    'PAYMENT_RETURN_THROTTLE_LIMIT',
  );
  const paymentReturnTtl = parsePositiveInt(
    config.get<string>('PAYMENT_RETURN_THROTTLE_TTL_MS'),
    60000,
    'PAYMENT_RETURN_THROTTLE_TTL_MS',
  );

  const trustedProxyHops = parsePositiveInt(
    config.get<string>('TRUSTED_PROXY_HOPS'),
    1,
    'TRUSTED_PROXY_HOPS',
  );

  return {
    throttlers: [
      {
        name: 'payment-confirm',
        limit: paymentConfirmLimit,
        ttl: paymentConfirmTtl,
      },
      {
        name: 'payment-return',
        limit: paymentReturnLimit,
        ttl: paymentReturnTtl,
      },
    ],
    getTracker: (req: Record<string, any>) =>
      getLoginTracker(
        req as Parameters<typeof getLoginTracker>[0],
        trustedProxyHops,
      ),
  };
}

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
  imports: [
    ConfigModule,
    MailModule,
    NotificationsModule,
    AuthModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: buildPaymentsThrottlerOptions,
    }),
  ],
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
