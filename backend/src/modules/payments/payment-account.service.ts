import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PaymentAccount } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PaymentGatewayClient,
  PaymentGatewayError,
} from './payment-gateway.client';
import { PaymentCredentialCryptoService } from './payment-credential-crypto.service';

export interface OnboardPaymentAccountInput {
  name: string;
  email: string;
  rutOrTaxId: string;
}

export interface PaymentAccountStatusView {
  status: string;
  merchantId: string | null;
  connectedAt: Date | null;
  lastError: string | null;
}

const DEFAULT_STATUS: PaymentAccountStatusView = {
  status: 'PENDING',
  merchantId: null,
  connectedAt: null,
  lastError: null,
};

// design.md "Therapist payment account is its own page" + "REST" table:
// sole owner of PaymentAccount's lifecycle (onboard/status/
// disconnect). PaymentsService (ensureCharge/updateAmount) only READS
// PaymentAccount -- it never writes it -- so both services can
// coexist in the same module without stepping on each other.
@Injectable()
export class PaymentAccountService {
  private readonly logger = new Logger(PaymentAccountService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: PaymentGatewayClient,
    private credentialCrypto: PaymentCredentialCryptoService,
  ) {}

  // T5.1: gateway.createMerchant -> upsert CONNECTED. The "credential" that
  // design.md asks to encrypt under PAYMENT_CREDENTIALS_ENCRYPTION_KEY has
  // no secret of its own returned by Flow today (PR 1's port only exposes
  // { merchantId }, see the header comment of
  // flow-gateway.client.ts) -- merchantId itself is encrypted as defense
  // in depth for the connected account's identifier,
  // consistent with the "never in plaintext" criterion already governing
  // GOOGLE_TOKEN_ENCRYPTION_KEY/DOCUMENT_ENCRYPTION_KEY. merchantId is also
  // kept in its own plaintext column because ensureCharge/updateAmount
  // (PR 1) need it undecrypted on every order issuance.
  async onboard(
    therapistId: string,
    input: OnboardPaymentAccountInput,
  ): Promise<PaymentAccountStatusView> {
    let merchantId: string;
    try {
      const result = await this.gateway.createMerchant({
        therapistId,
        name: input.name,
        email: input.email,
        rutOrTaxId: input.rutOrTaxId,
      });
      merchantId = result.merchantId;
    } catch (err) {
      const message =
        err instanceof PaymentGatewayError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      this.logger.error(
        `Fallo al conectar la cuenta de pagos (therapistId=${therapistId}): ${message}`,
      );
      await this.prisma.paymentAccount.upsert({
        where: { therapistId },
        create: { therapistId, status: 'PENDING', lastError: message },
        update: { status: 'PENDING', lastError: message },
      });
      throw new BadRequestException(
        'No se pudo conectar la cuenta de pagos con el proveedor.',
      );
    }

    const credentialEncrypted = this.credentialCrypto.encrypt(
      Buffer.from(JSON.stringify({ merchantId }), 'utf-8'),
    );

    const account = await this.prisma.paymentAccount.upsert({
      where: { therapistId },
      create: {
        therapistId,
        provider: 'FLOW',
        status: 'CONNECTED',
        merchantId,
        credentialEncrypted: Uint8Array.from(credentialEncrypted),
        connectedAt: new Date(),
        lastError: null,
      },
      update: {
        status: 'CONNECTED',
        merchantId,
        credentialEncrypted: Uint8Array.from(credentialEncrypted),
        connectedAt: new Date(),
        lastError: null,
      },
    });

    return this.toStatusView(account);
  }

  // T5.2: never returns credentialEncrypted (design.md REST table "Status
  // only -- never the credential").
  async status(therapistId: string): Promise<PaymentAccountStatusView> {
    const account = await this.prisma.paymentAccount.findUnique({
      where: { therapistId },
    });
    return account ? this.toStatusView(account) : DEFAULT_STATUS;
  }

  // T5.3: count-gated updateMany (same atomic "claim" pattern as
  // CalendarOauthService.disconnect/NotificationsService.markRead) -- 0
  // rows affected covers both "never existed" and "already
  // disconnected", both cases return the same uniform 404.
  // credentialEncrypted is cleared (revokes the local secret); merchantId is
  // kept so a future reconnect can reuse the same associated-merchant id
  // instead of creating a new one in Flow.
  async disconnect(therapistId: string): Promise<{ status: string }> {
    const result = await this.prisma.paymentAccount.updateMany({
      where: { therapistId, status: 'CONNECTED' },
      data: { status: 'DISCONNECTED', credentialEncrypted: null },
    });
    if (result.count === 0) {
      throw new NotFoundException('No hay una cuenta de pagos conectada.');
    }
    return { status: 'DISCONNECTED' };
  }

  private toStatusView(
    account: Partial<PaymentAccount>,
  ): PaymentAccountStatusView {
    return {
      status: account.status ?? 'PENDING',
      merchantId: account.merchantId ?? null,
      connectedAt: account.connectedAt ?? null,
      lastError: account.lastError ?? null,
    };
  }
}
