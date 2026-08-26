import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

// sdd/session-reminders PR 2 (T5.1): sendSessionReminderEmail sigue el mismo
// contrato "nunca lanza" que el resto de MailService (ver
// sendVerificationEmail) -- sin RESEND_API_KEY, el envío se saltea con un
// log en vez de fallar, para que el canal in-app nunca quede bloqueado por
// el canal de email (design.md "Channels dispatch independently").
const sendMock = jest.fn();

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
