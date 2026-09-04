import { PaymentProvider } from '@prisma/client';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import {
  CredentialValidation,
  GatewayOrderStatus,
  PaymentGatewayClient,
  PaymentGatewayError,
} from './payment-gateway.client';

// design.md "PaymentGatewayRegistry (new)": a minimal stub adapter is enough
// here -- this suite only exercises provider -> instance lookup, not any
// gateway-specific behavior (that's flow-gateway.client.spec.ts's job).
class StubGatewayClient extends PaymentGatewayClient {
  constructor(readonly provider: PaymentProvider) {
    super();
  }

  validateCredentials(): Promise<CredentialValidation> {
    throw new Error('not implemented in stub');
  }

  createOrder(): Promise<{ token: string; paymentUrl: string }> {
    throw new Error('not implemented in stub');
  }

  getOrderStatus(): Promise<{
    status: GatewayOrderStatus;
    gatewayPaymentId?: string;
  }> {
    throw new Error('not implemented in stub');
  }

  verifyCallbackSignature(): boolean {
    throw new Error('not implemented in stub');
  }
}

describe('PaymentGatewayRegistry', () => {
  it('devuelve el adaptador registrado para un provider conocido', () => {
    const flow = new StubGatewayClient(PaymentProvider.FLOW);
    const registry = new PaymentGatewayRegistry([flow]);

    expect(registry.get(PaymentProvider.FLOW)).toBe(flow);
  });

  it('lanza PaymentGatewayError(credentials) para un provider sin adaptador registrado', () => {
    const registry = new PaymentGatewayRegistry([]);

    expect(() => registry.get(PaymentProvider.FLOW)).toThrow(
      PaymentGatewayError,
    );
    try {
      registry.get(PaymentProvider.FLOW);
      fail('expected registry.get to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PaymentGatewayError);
      expect((err as PaymentGatewayError).kind).toBe('credentials');
    }
  });

  it('no confunde adaptadores de distintos providers registrados juntos', () => {
    const flow = new StubGatewayClient(PaymentProvider.FLOW);
    // Segundo adaptador con el mismo provider simula un registro futuro con
    // más de un proveedor real -- aquí solo se valida que el lookup por
    // provider no devuelve un adaptador incorrecto.
    const registry = new PaymentGatewayRegistry([flow]);

    expect(registry.get(PaymentProvider.FLOW)).toBe(flow);
  });
});
