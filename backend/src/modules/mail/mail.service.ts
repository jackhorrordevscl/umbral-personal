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
    this.from =
      this.config.get<string>('MAIL_FROM') ??
      'Umbral - RCE <onboarding@resend.dev>';
  }

  async sendVerificationEmail(
    to: string,
    name: string,
    verifyUrl: string,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY no configurada: se salteó el envío del email de verificación a ${to}.`,
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Verifica tu cuenta en Umbral - RCE',
      html: `
        <p>Hola ${name},</p>
        <p>Crea tu cuenta en Umbral - RCE haciendo clic en el siguiente enlace:</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p>Si no creaste esta cuenta, puedes ignorar este email.</p>
      `,
    });

    if (error) {
      // No se relanza como excepción HTTP: el signup ya persistió la cuenta,
      // y el remitente puede reintentar el envío más adelante (T-futuro:
      // reenviar verificación) sin perder el registro. Se deja constancia en
      // logs para que quede visible en monitoreo.
      this.logger.error(
        `Falló el envío del email de verificación a ${to}: ${error.message}`,
      );
    }
  }

  async sendPasswordResetEmail(
    to: string,
    name: string,
    resetUrl: string,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY no configurada: se salteó el envío del email de restablecimiento a ${to}.`,
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Restablece tu contraseña en Umbral - RCE',
      html: `
        <p>Hola ${name},</p>
        <p>Restablece tu contraseña haciendo clic en el siguiente enlace (válido por 30 minutos):</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>Si no solicitaste este cambio, puedes ignorar este email; tu contraseña actual sigue siendo válida.</p>
      `,
    });

    if (error) {
      // Mismo motivo que sendVerificationEmail: no se relanza como excepción
      // HTTP, forgotPassword ya respondió el mensaje genérico al cliente.
      this.logger.error(
        `Falló el envío del email de restablecimiento a ${to}: ${error.message}`,
      );
    }
  }

  // Issue #76: link de confirmación enviado a la casilla NUEVA (pendiente),
  // no a la activa -- ver EmailChangeService.requestChange.
  async sendEmailChangeVerificationEmail(
    to: string,
    name: string,
    confirmUrl: string,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY no configurada: se salteó el envío del email de confirmación de cambio de email a ${to}.`,
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Confirma tu nuevo email en Umbral - RCE',
      html: `
        <p>Hola ${name},</p>
        <p>Confirma tu nueva dirección de email en Umbral - RCE haciendo clic en el siguiente enlace (válido por 24 horas):</p>
        <p><a href="${confirmUrl}">${confirmUrl}</a></p>
        <p>Si no solicitaste este cambio, puedes ignorar este email; tu dirección actual sigue siendo válida.</p>
      `,
    });

    if (error) {
      this.logger.error(
        `Falló el envío del email de confirmación de cambio de email a ${to}: ${error.message}`,
      );
    }
  }

  // Issue #76: notificación informativa a la dirección ACTUAL (todavía
  // activa) cada vez que se acepta una solicitud de cambio de email --
  // independiente del flujo de verificación en la casilla nueva, para que
  // el dueño real se entere aunque el request no lo haya hecho él (sesión
  // robada) por un canal que el atacante no controla.
  async sendEmailChangeNoticeEmail(
    to: string,
    name: string,
    newEmail: string,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY no configurada: se salteó el envío de la notificación de cambio de email a ${to}.`,
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Se solicitó un cambio de email en tu cuenta de Umbral - RCE',
      html: `
        <p>Hola ${name},</p>
        <p>Se solicitó cambiar el email de tu cuenta a <strong>${newEmail}</strong>. El cambio no se aplica hasta que se confirme desde esa nueva dirección.</p>
        <p>Si no solicitaste este cambio, contacta a soporte lo antes posible.</p>
      `,
    });

    if (error) {
      this.logger.error(
        `Falló el envío de la notificación de cambio de email a ${to}: ${error.message}`,
      );
    }
  }
}
