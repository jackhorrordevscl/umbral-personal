import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    // Sin RESEND_API_KEY (test, o dev sin cuenta configurada) el envío se
    // saltea con un log en vez de fallar: firmar/crear la cuenta no debe
    // depender de tener Resend configurado para correr los tests o levantar
    // el backend en local.
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from = this.config.get<string>('MAIL_FROM') ?? 'Umbral SpA <onboarding@resend.dev>';
  }

  async sendVerificationEmail(to: string, name: string, verifyUrl: string): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY no configurada: se salteó el envío del email de verificación a ${to}.`,
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Verifica tu cuenta en Umbral SpA',
      html: `
        <p>Hola ${name},</p>
        <p>Crea tu cuenta en Umbral SpA haciendo clic en el siguiente enlace:</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p>Si no creaste esta cuenta, puedes ignorar este email.</p>
      `,
    });

    if (error) {
      // No se relanza como excepción HTTP: el signup ya persistió la cuenta,
      // y el remitente puede reintentar el envío más adelante (T-futuro:
      // reenviar verificación) sin perder el registro. Se deja constancia en
      // logs para que quede visible en monitoreo.
      this.logger.error(`Falló el envío del email de verificación a ${to}: ${error.message}`);
    }
  }
}
