import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

// sdd/session-reminders PR 2 (T5.1): sendSessionReminderEmail sigue el mismo
// contrato "nunca lanza" que el resto de MailService (ver
// sendVerificationEmail) -- sin RESEND_API_KEY, el envío se saltea con un
// log en vez de fallar, para que el canal in-app nunca quede bloqueado por
// el canal de email (design.md "Channels dispatch independently").
const sendMock = jest.fn<
  Promise<{ data: { id: string } | null; error: { message: string } | null }>,
  [{ from: string; to: string; subject: string; html: string }]
>();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

function buildConfig(
  values: Record<string, string | undefined>,
): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('MailService.sendSessionReminderEmail', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('envía el recordatorio con el nombre del paciente y el offset en el asunto cuando RESEND_API_KEY está configurada', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    const service = new MailService(
      buildConfig({ RESEND_API_KEY: 'test-key' }),
    );

    await service.sendSessionReminderEmail(
      'therapist@example.com',
      'Dra. Pérez',
      'Juan Soto',
      new Date('2026-06-16T14:00:00.000Z'),
      '24 horas',
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(payload.to).toBe('therapist@example.com');
    expect(payload.subject).toContain('24 horas');
    expect(payload.html).toContain('Juan Soto');
    expect(payload.html).toContain('Dra. Pérez');
  });

  it('no lanza y no intenta enviar si RESEND_API_KEY no está configurada (skip silencioso)', async () => {
    const service = new MailService(buildConfig({}));

    await expect(
      service.sendSessionReminderEmail(
        'therapist@example.com',
        'Dra. Pérez',
        'Juan Soto',
        new Date('2026-06-16T14:00:00.000Z'),
        '2 horas',
      ),
    ).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('no lanza si el proveedor de email responde con error (loggea, no relanza)', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: 'provider down' },
    });
    const service = new MailService(
      buildConfig({ RESEND_API_KEY: 'test-key' }),
    );

    await expect(
      service.sendSessionReminderEmail(
        'therapist@example.com',
        'Dra. Pérez',
        'Juan Soto',
        new Date('2026-06-16T14:00:00.000Z'),
        '2 horas',
      ),
    ).resolves.toBeUndefined();
  });
});

// sdd/online-payment-integration PR 3 (T8.1/T10.1-10.2): mismo contrato
// "nunca lanza" que el resto de MailService, con la diferencia de que este
// método SÍ devuelve un booleano -- PaymentsService.ensureCharge lo usa para
// decidir linkDelivery = SENT|FAILED (design.md "Link delivery has an
// explicit persisted state and never blocks the charge").
describe('MailService.sendPaymentLinkEmail', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('envía el link de pago con el monto formateado y resuelve true cuando RESEND_API_KEY está configurada', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    const service = new MailService(
      buildConfig({ RESEND_API_KEY: 'test-key' }),
    );

    const sent = await service.sendPaymentLinkEmail(
      'paciente@example.com',
      'Juan Soto',
      'https://flow.cl/pay/token-1',
      30000,
    );

    expect(sent).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(payload.to).toBe('paciente@example.com');
    expect(payload.html).toContain('Juan Soto');
    expect(payload.html).toContain('https://flow.cl/pay/token-1');
    expect(payload.html).toContain('$30.000');
  });

  it('no lanza, no intenta enviar, y resuelve false si RESEND_API_KEY no está configurada (skip silencioso)', async () => {
    const service = new MailService(buildConfig({}));

    await expect(
      service.sendPaymentLinkEmail(
        'paciente@example.com',
        'Juan Soto',
        'https://flow.cl/pay/token-1',
        30000,
      ),
    ).resolves.toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('no lanza y resuelve false si el proveedor de email responde con error (loggea, no relanza)', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: 'provider down' },
    });
    const service = new MailService(
      buildConfig({ RESEND_API_KEY: 'test-key' }),
    );

    await expect(
      service.sendPaymentLinkEmail(
        'paciente@example.com',
        'Juan Soto',
        'https://flow.cl/pay/token-1',
        30000,
      ),
    ).resolves.toBe(false);
  });
});

// sdd/online-payment-integration PR 3 (T8.2/T10.1-10.2): mismo contrato
// "nunca lanza" -- Promise<void>, sin estado de entrega persistido propio
// (ver comentario de sendLatePaymentEmail en mail.service.ts).
describe('MailService.sendLatePaymentEmail', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('envía el aviso de cobro vencido con el monto y la fecha formateados cuando RESEND_API_KEY está configurada', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    const service = new MailService(
      buildConfig({ RESEND_API_KEY: 'test-key' }),
    );

    await service.sendLatePaymentEmail(
      'paciente@example.com',
      'Juan Soto',
      30000,
      new Date('2026-06-16T14:00:00.000Z'),
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(payload.to).toBe('paciente@example.com');
    expect(payload.html).toContain('Juan Soto');
    expect(payload.html).toContain('$30.000');
  });

  it('no lanza y no intenta enviar si RESEND_API_KEY no está configurada (skip silencioso)', async () => {
    const service = new MailService(buildConfig({}));

    await expect(
      service.sendLatePaymentEmail(
        'paciente@example.com',
        'Juan Soto',
        30000,
        new Date('2026-06-16T14:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('no lanza si el proveedor de email responde con error (loggea, no relanza)', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: 'provider down' },
    });
    const service = new MailService(
      buildConfig({ RESEND_API_KEY: 'test-key' }),
    );

    await expect(
      service.sendLatePaymentEmail(
        'paciente@example.com',
        'Juan Soto',
        30000,
        new Date('2026-06-16T14:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();
  });
});
