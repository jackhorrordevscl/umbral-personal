import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentAccount,
  PaymentAccountStatus,
  PaymentProvider,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CredentialValidation,
  GatewayContext,
  GatewayCredentials,
  PaymentGatewayError,
} from './payment-gateway.client';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { PaymentCredentialCryptoService } from './payment-credential-crypto.service';

export interface GatewayCredentialsInput {
  apiKey: string;
  secretKey: string;
}

export interface ValidateCredentialsInput extends GatewayCredentialsInput {
  provider?: PaymentProvider;
}

export interface ConnectAccountInput extends GatewayCredentialsInput {
  provider?: PaymentProvider;
  displayName?: string;
}

export interface PaymentAccountStatusView {
  status: PaymentAccountStatus;
  provider: PaymentProvider;
  displayName: string | null;
  keyFingerprint: string | null;
  connectedAt: Date | null;
  lastError: string | null;
}

const DEFAULT_STATUS: PaymentAccountStatusView = {
  status: PaymentAccountStatus.PENDING,
  provider: PaymentProvider.FLOW,
  displayName: null,
  keyFingerprint: null,
  connectedAt: null,
  lastError: null,
};

// design.md "Open Questions": the exact field-level format check for
// "malformed" credentials is not specified by Flow's docs reviewed so far
// -- this is a best-effort format gate (non-empty, no whitespace, a
// plausible key length), same "UNVERIFIED against a real sandbox" caveat
// flow-gateway.client.ts already carries for its status-code mapping. It
// only rejects values that are clearly NOT a Flow key; it can never
// guarantee validity -- that's what the live probe (registry.get(...)
// .validateCredentials) is for.
const CREDENTIAL_FORMAT = /^[A-Za-z0-9_-]{16,128}$/;

// design.md "PaymentAccountService" (Component Responsibilities) + Decision
// 2: sole owner of PaymentAccount R/W, and the ONLY caller of
// credentialCrypto.decrypt (resolveGatewayContext). validate() never
// writes -- it exists purely so the wizard's paste step can confirm a
// credential pair against Flow before anything is persisted (spec
// "Guided Connection Wizard With Pre-Persistence Validation"). connect()
// re-validates independently (the wizard's client-held "already
// validated" state is never trusted server-side) and only then encrypts
// and persists. PaymentsService (Phase 3) never touches this table or the
// ciphertext -- it asks resolveGatewayContext() for a context or null.
@Injectable()
export class PaymentAccountService {
  private readonly logger = new Logger(PaymentAccountService.name);

  constructor(
    private prisma: PrismaService,
    private registry: PaymentGatewayRegistry,
    private credentialCrypto: PaymentCredentialCryptoService,
  ) {}

  // spec "Malformed credentials are rejected before calling Flow": format
  // validation happens BEFORE the registry/gateway is ever touched, and
  // this method makes no Prisma call either -- a failed validate() (format
  // or live-probe rejection) persists nothing, by construction.
  async validate(
    input: ValidateCredentialsInput,
  ): Promise<CredentialValidation> {
    this.assertWellFormed(input);
    const provider = input.provider ?? PaymentProvider.FLOW;
    const credentials = new GatewayCredentials(input.apiKey, input.secretKey);
    return this.registry.get(provider).validateCredentials(credentials);
  }

  // design.md sequence "Connect account — after", step 2: re-validate (same
  // probe as validate()) before ever calling credentialCrypto.encrypt --
  // the wizard's earlier validate() call is never trusted as proof by
  // itself. On a gateway rejection, only `lastError` is written (status is
  // left untouched, so a RECONNECT_REQUIRED/DISCONNECTED account that
  // fails a reconnect attempt stays exactly where it was); only a
  // Flow-confirmed pair reaches the CONNECTED upsert with the v2
  // (`{apiKey,secretKey}`) encrypted blob.
  async connect(
    therapistId: string,
    input: ConnectAccountInput,
  ): Promise<PaymentAccountStatusView> {
    this.assertWellFormed(input);
    const provider = input.provider ?? PaymentProvider.FLOW;
    const credentials = new GatewayCredentials(input.apiKey, input.secretKey);

    let validation: CredentialValidation;
    try {
      validation = await this.registry
        .get(provider)
        .validateCredentials(credentials);
    } catch (err) {
      const message = this.describeGatewayError(err);
      this.logger.error(
        `No se pudo conectar la cuenta de pagos (therapistId=${therapistId}): ${message}`,
      );
      await this.prisma.paymentAccount.upsert({
        where: { therapistId },
        create: {
          therapistId,
          provider,
          status: PaymentAccountStatus.PENDING,
          lastError: message,
        },
        update: { lastError: message },
      });
      throw new BadRequestException(message);
    }

    const credentialEncrypted = this.credentialCrypto.encrypt(
      Buffer.from(
        JSON.stringify({ apiKey: input.apiKey, secretKey: input.secretKey }),
        'utf-8',
      ),
    );
    // design.md Decision 1 "Consequence": Flow's response wins when it
    // exposes a commerce name; the therapist-typed label is only the
    // fallback the confirmation step falls back to.
    const displayName = validation.accountLabel ?? input.displayName ?? null;

    const account = await this.prisma.paymentAccount.upsert({
      where: { therapistId },
      create: {
        therapistId,
        provider,
        status: PaymentAccountStatus.CONNECTED,
        displayName,
        keyFingerprint: validation.keyFingerprint,
        credentialVersion: 2,
        credentialEncrypted: Uint8Array.from(credentialEncrypted),
        connectedAt: new Date(),
        lastError: null,
      },
      update: {
        status: PaymentAccountStatus.CONNECTED,
        provider,
        displayName,
        keyFingerprint: validation.keyFingerprint,
        credentialVersion: 2,
        credentialEncrypted: Uint8Array.from(credentialEncrypted),
        connectedAt: new Date(),
        lastError: null,
      },
    });

    return this.toStatusView(account);
  }

  // design.md Decision 2: returns null for anything other than CONNECTED
  // (missing account / PENDING / DISCONNECTED / RECONNECT_REQUIRED) --
  // callers (PaymentsService) reuse the existing "no order, charge stays
  // PENDING" degradation path unchanged. Also guards on
  // credentialVersion === 2: a v1 (`{merchantId}`) row can still be
  // CONNECTED in the window between the M1 schema migration and the M2
  // data migration (design.md "Deploy new backend + frontend must precede
  // M2") -- this is the "explicit shape discriminator, never guessing the
  // blob" credentialVersion exists for, so a legacy blob degrades the same
  // way a disconnected account does instead of being parsed as
  // `{apiKey,secretKey}`.
  async resolveGatewayContext(
    therapistId: string,
  ): Promise<GatewayContext | null> {
    const account = await this.prisma.paymentAccount.findUnique({
      where: { therapistId },
    });
    if (
      !account ||
      account.status !== PaymentAccountStatus.CONNECTED ||
      account.credentialVersion !== 2 ||
      !account.credentialEncrypted
    ) {
      return null;
    }

    const decrypted = this.credentialCrypto.decrypt(
      Buffer.from(account.credentialEncrypted),
    );
    const parsed = JSON.parse(
      decrypted.toString('utf-8'),
    ) as GatewayCredentialsInput;

    return {
      provider: account.provider,
      credentials: new GatewayCredentials(parsed.apiKey, parsed.secretKey),
    };
  }

  // Read-only, non-secret status view for GET /account (design.md
  // "Secret-Handling Invariants": never returns credentialEncrypted, never
  // merchantId).
  async status(therapistId: string): Promise<PaymentAccountStatusView> {
    const account = await this.prisma.paymentAccount.findUnique({
      where: { therapistId },
    });
    return account ? this.toStatusView(account) : DEFAULT_STATUS;
  }

  // Same atomic "claim" pattern as CalendarOauthService.disconnect /
  // NotificationsService.markRead -- 0 rows affected covers both "never
  // existed" and "already disconnected", both cases return the same
  // uniform 404. Only a CONNECTED account can be disconnected (spec
  // "Self-Service Disconnection"); credentialEncrypted is cleared (revokes
  // the local secret), displayName/keyFingerprint are kept as the last-known
  // display metadata.
  async disconnect(
    therapistId: string,
  ): Promise<{ status: PaymentAccountStatus }> {
    const result = await this.prisma.paymentAccount.updateMany({
      where: { therapistId, status: PaymentAccountStatus.CONNECTED },
      data: {
        status: PaymentAccountStatus.DISCONNECTED,
        credentialEncrypted: null,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('No hay una cuenta de pagos conectada.');
    }
    return { status: PaymentAccountStatus.DISCONNECTED };
  }

  private assertWellFormed(input: GatewayCredentialsInput): void {
    if (
      !CREDENTIAL_FORMAT.test(input.apiKey) ||
      !CREDENTIAL_FORMAT.test(input.secretKey)
    ) {
      throw new BadRequestException(
        'apiKey/secretKey no tienen el formato esperado por Flow.',
      );
    }
  }

  private describeGatewayError(err: unknown): string {
    return err instanceof PaymentGatewayError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  }

  private toStatusView(
    account: Partial<PaymentAccount>,
  ): PaymentAccountStatusView {
    return {
      status: account.status ?? PaymentAccountStatus.PENDING,
      provider: account.provider ?? PaymentProvider.FLOW,
      displayName: account.displayName ?? null,
      keyFingerprint: account.keyFingerprint ?? null,
      connectedAt: account.connectedAt ?? null,
      lastError: account.lastError ?? null,
    };
  }
}
