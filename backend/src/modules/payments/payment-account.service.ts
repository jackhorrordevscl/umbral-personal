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
// dueño exclusivo del ciclo de vida de PaymentAccount (onboard/status/
// disconnect). PaymentsService (ensureCharge/updateAmount) solo LEE
// PaymentAccount -- nunca la escribe -- así que ambos servicios pueden
// convivir en el mismo módulo sin pisarse.
@Injectable()
export class PaymentAccountService {
  private readonly logger = new Logger(PaymentAccountService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: PaymentGatewayClient,
    private credentialCrypto: PaymentCredentialCryptoService,
  ) {}

  // T5.1: gateway.createMerchant -> upsert CONNECTED. El "credential" que
  // design.md pide cifrar bajo PAYMENT_CREDENTIALS_ENCRYPTION_KEY no tiene
  // hoy un secreto propio devuelto por Flow (el puerto de PR 1 solo expone
  // { merchantId }, ver el comentario del encabezado de
  // flow-gateway.client.ts) -- se cifra el propio merchantId como defensa
  // en profundidad para el identificador de la cuenta conectada,
  // consistente con el criterio de "nunca en claro" que ya rige
  // GOOGLE_TOKEN_ENCRYPTION_KEY/DOCUMENT_ENCRYPTION_KEY. merchantId también
  // queda en su propia columna en claro porque ensureCharge/updateAmount
  // (PR 1) lo necesitan sin descifrar en cada emisión de orden.
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

  // T5.2: nunca devuelve credentialEncrypted (design.md REST table "Status
  // only -- never the credential").
  async status(therapistId: string): Promise<PaymentAccountStatusView> {
    const account = await this.prisma.paymentAccount.findUnique({
      where: { therapistId },
    });
    return account ? this.toStatusView(account) : DEFAULT_STATUS;
  }

  // T5.3: updateMany count-gated (mismo patrón "claim" atómico que
  // CalendarOauthService.disconnect/NotificationsService.markRead) -- 0
  // filas afectadas cubre tanto "nunca existió" como "ya estaba
  // desconectada", ambos casos devuelven el mismo 404 uniforme.
  // credentialEncrypted se limpia (revoca el secreto local); merchantId se
  // conserva para que un reconnect futuro pueda reutilizar el mismo id de
  // comercio asociado en vez de crear uno nuevo en Flow.
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
