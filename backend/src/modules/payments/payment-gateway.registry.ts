import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import {
  PaymentGatewayClient,
  PaymentGatewayError,
} from './payment-gateway.client';

// design.md "PaymentGatewayRegistry (new)": maps PaymentProvider -> adapter
// singleton. Built from the list of registered adapters -- payments.module.ts
// (Phase 3, task 3.4) injects one entry per implemented provider (today:
// FLOW/FlowPaymentGatewayClient). Adding a second gateway
// (proposal.md "Extensible gateway selection") is a new adapter class plus
// one more entry in that array; this registry needs no changes.
@Injectable()
export class PaymentGatewayRegistry {
  private readonly clientsByProvider: ReadonlyMap<
    PaymentProvider,
    PaymentGatewayClient
  >;

  constructor(clients: PaymentGatewayClient[]) {
    this.clientsByProvider = new Map(
      clients.map((client) => [client.provider, client]),
    );
  }

  // design.md "PaymentGatewayRegistry (new)": unknown provider ->
  // PaymentGatewayError('credentials') -- same failure kind
  // PaymentAccountService/PaymentsService already treat as "the account
  // isn't usable", so an unregistered provider degrades the same way an
  // invalid credential does, with no new error kind for callers to handle.
  get(provider: PaymentProvider): PaymentGatewayClient {
    const client = this.clientsByProvider.get(provider);
    if (!client) {
      throw new PaymentGatewayError(
        'credentials',
        `No hay un adaptador de pasarela de pago registrado para el proveedor "${provider}".`,
      );
    }
    return client;
  }
}
