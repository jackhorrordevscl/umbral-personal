import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

// T4b (informe de alta): aviso de cancelación de consultas por el cierre del
// tratamiento. Mismo contrato "nunca lanza" que el resto de MailService.
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

const SESSIONS = [
  new Date('2026-10-20T14:00:00.000Z'),
  new Date('2026-10-27T14:00:00.000Z'),
];

describe('MailService.sendConsultationCancelledEmail', () => {
  beforeEach(() => sendMock.mockReset());

  it('envía el aviso con las fechas en hora de Chile y devuelve true', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    const service = new MailService(buildConfig({ RESEND_API_KEY: 'key' }));

    const sent = await service.sendConsultationCancelledEmail(
      'paciente@example.com',
      'Luis Soto',
      'Dra. Pérez',
      SESSIONS,
    );

    expect(sent).toBe(true);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.to).toBe('paciente@example.com');
    expect(payload.html).toContain('Luis Soto');
    expect(payload.html).toContain('Dra. Pérez');
    // 14:00 UTC es 11:00 en Chile en octubre (UTC-3).
    expect(payload.html).toContain('11:00');
    expect(payload.html).toContain('20 de octubre');
    expect(payload.html).toContain('27 de octubre');
  });

  it('no incluye ningún motivo del cierre', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    const service = new MailService(buildConfig({ RESEND_API_KEY: 'key' }));

    await service.sendConsultationCancelledEmail(
      'paciente@example.com',
      'Luis Soto',
      'Dra. Pérez',
      SESSIONS,
    );

    const { html, subject } = sendMock.mock.calls[0][0];
    for (const word of ['alta', 'deserción', 'derivación', 'abandono']) {
      expect(html.toLowerCase()).not.toContain(word);
      expect(subject.toLowerCase()).not.toContain(word);
    }
  });

  it('escapa HTML en los nombres', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    const service = new MailService(buildConfig({ RESEND_API_KEY: 'key' }));

    await service.sendConsultationCancelledEmail(
      'paciente@example.com',
      '<script>alert(1)</script>',
      'Dra. <b>Pérez</b>',
      SESSIONS,
    );

    const { html } = sendMock.mock.calls[0][0];
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Pérez</b>');
  });

  it('sin RESEND_API_KEY no lanza, no envía y devuelve false', async () => {
    const service = new MailService(buildConfig({}));

    await expect(
      service.sendConsultationCancelledEmail(
        'paciente@example.com',
        'Luis Soto',
        'Dra. Pérez',
        SESSIONS,
      ),
    ).resolves.toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('si el proveedor responde con error no lanza y devuelve false', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: 'provider down' },
    });
    const service = new MailService(buildConfig({ RESEND_API_KEY: 'key' }));

    await expect(
      service.sendConsultationCancelledEmail(
        'paciente@example.com',
        'Luis Soto',
        'Dra. Pérez',
        SESSIONS,
      ),
    ).resolves.toBe(false);
  });

  it('si el envío lanza una excepción no la propaga y devuelve false', async () => {
    sendMock.mockRejectedValue(new Error('network'));
    const service = new MailService(buildConfig({ RESEND_API_KEY: 'key' }));

    await expect(
      service.sendConsultationCancelledEmail(
        'paciente@example.com',
        'Luis Soto',
        'Dra. Pérez',
        SESSIONS,
      ),
    ).resolves.toBe(false);
  });
});
