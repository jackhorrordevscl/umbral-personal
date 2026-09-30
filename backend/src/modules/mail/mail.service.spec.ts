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

  it('envía el recordatorio con el nombre del paciente y el offset en el asunto, y devuelve el id de Resend cuando RESEND_API_KEY está configurada (issue #163)', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    const service = new MailService(
      buildConfig({ RESEND_API_KEY: 'test-key' }),
    );

    const resendMessageId = await service.sendSessionReminderEmail(
      'therapist@example.com',
      'Dra. Pérez',
      'Juan Soto',
      new Date('2026-06-16T14:00:00.000Z'),
      '24 horas',
    );

    expect(resendMessageId).toBe('email-1');
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

  it('no lanza, no intenta enviar, y resuelve null si RESEND_API_KEY no está configurada (skip silencioso, issue #163)', async () => {
    const service = new MailService(buildConfig({}));

    await expect(
      service.sendSessionReminderEmail(
        'therapist@example.com',
        'Dra. Pérez',
        'Juan Soto',
        new Date('2026-06-16T14:00:00.000Z'),
        '2 horas',
      ),
    ).resolves.toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('no lanza y resuelve null si el proveedor de email responde con error (loggea, no relanza, issue #163)', async () => {
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
    ).resolves.toBeNull();
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

// Issue #300: los nombres y emails controlados por el usuario se
// interpolaban sin escapar en el HTML de los emails.
describe('MailService: escape de HTML en templates (issue #300)', () => {
  const HOSTILE = [
    '<img src=x onerror=alert(1)>',
    '"><script>alert(1)</script>',
    '&amp;',
  ];
  const URL = 'https://app.example.com/verify?token=a&next=b';

  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  });

  const build = () =>
    new MailService(buildConfig({ RESEND_API_KEY: 'test-key' }));
  const sentHtml = () => sendMock.mock.calls[0][0].html;

  const senders: Array<
    [string, (s: MailService, v: string) => Promise<unknown>]
  > = [
    [
      'sendVerificationEmail',
      (s, v) => s.sendVerificationEmail('a@b.cl', v, URL),
    ],
    [
      'sendPasswordResetEmail',
      (s, v) => s.sendPasswordResetEmail('a@b.cl', v, URL),
    ],
    [
      'sendEmailChangeVerificationEmail',
      (s, v) => s.sendEmailChangeVerificationEmail('a@b.cl', v, URL),
    ],
    [
      'sendEmailChangeNoticeEmail (name)',
      (s, v) => s.sendEmailChangeNoticeEmail('a@b.cl', v, 'n@b.cl'),
    ],
    [
      'sendEmailChangeNoticeEmail (newEmail)',
      (s, v) => s.sendEmailChangeNoticeEmail('a@b.cl', 'Ana', v),
    ],
    [
      'sendSessionReminderEmail (therapist)',
      (s, v) =>
        s.sendSessionReminderEmail('a@b.cl', v, 'Juan', new Date(), '2 horas'),
    ],
    [
      'sendSessionReminderEmail (patient)',
      (s, v) =>
        s.sendSessionReminderEmail('a@b.cl', 'Dra.', v, new Date(), '2 horas'),
    ],
    [
      'sendPaymentLinkEmail',
      (s, v) => s.sendPaymentLinkEmail('a@b.cl', v, 'https://flow.cl/p', 1000),
    ],
    [
      'sendLatePaymentEmail',
      (s, v) => s.sendLatePaymentEmail('a@b.cl', v, 1000, new Date()),
    ],
  ];

  describe.each(senders)('%s', (_label, send) => {
    it.each(HOSTILE)('escapa el valor hostil %s', async (hostile) => {
      await send(build(), hostile);

      const html = sentHtml();
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<script');
      expect(html).toContain(
        hostile
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;'),
      );
    });

    it('conserva nombres legítimos con tildes y apostrofes', async () => {
      await send(build(), "José Núñez O'Brien");

      const html = sentHtml();
      expect(html).toContain('José Núñez O&#39;Brien');
    });
  });

  it('escapa las URLs (href y texto) sin romper el atributo', async () => {
    await build().sendVerificationEmail(
      'a@b.cl',
      'Ana',
      'https://x.cl/?a=1&b="><script>',
    );

    const html = sentHtml();
    expect(html).not.toContain('<script');
    expect(html).toContain(
      'href="https://x.cl/?a=1&amp;b=&quot;&gt;&lt;script&gt;"',
    );
  });
});
