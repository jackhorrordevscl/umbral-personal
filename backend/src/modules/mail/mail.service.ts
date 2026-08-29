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

  // sdd/session-reminders PR 2 (T5.1): llamado por RemindersService por cada
  // (consultation, offset) despachado por el canal EMAIL. Mismo contrato
  // "nunca lanza" que el resto de esta clase -- design.md "Email Channel
  // Degrades Gracefully": sin RESEND_API_KEY el envío se saltea con un log,
  // y RemindersService igual crea la notificación in-app para ese mismo
  // (consultation, offset) sin bloquearse por esto (design.md "Channels
  // dispatch independently").
  async sendSessionReminderEmail(
    to: string,
    therapistName: string,
    patientFullName: string,
    when: Date,
    offsetLabel: string,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY no configurada: se salteó el recordatorio de sesión (${offsetLabel}) a ${to}.`,
      );
      return;
    }

    // Zona horaria fija a propósito (America/Santiago, mismo criterio que
    // design.md "UTC instant arithmetic; explicit render zone"): esta clase
    // solo renderiza texto humano, nunca decide due-ness.
    const formattedWhen = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(when);

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: `Recordatorio de sesión en ${offsetLabel}`,
      html: `
        <p>Hola ${therapistName},</p>
        <p>Tu sesión con <strong>${patientFullName}</strong> está programada para ${formattedWhen} (en ${offsetLabel}).</p>
      `,
    });

    if (error) {
      this.logger.error(
        `Falló el envío del recordatorio de sesión a ${to}: ${error.message}`,
      );
    }
  }

  // sdd/online-payment-integration PR 3 (T8.1): a diferencia del resto de
  // esta clase (siempre Promise<void>), este método SÍ devuelve un booleano
  // -- design.md "Link delivery has an explicit persisted state and never
  // blocks the charge": PaymentsService.ensureCharge necesita saber si el
  // envío realmente ocurrió para persistir linkDelivery = SENT|FAILED (la
  // decisión SKIPPED_NO_EMAIL se toma antes, en el caller, cuando no hay
  // patient.email -- este método nunca se llama en ese caso). El contrato
  // "nunca lanza" se mantiene igual: sin RESEND_API_KEY o con error del
  // proveedor, resuelve `false` en vez de propagar una excepción.
  async sendPaymentLinkEmail(
    to: string,
    patientName: string,
    paymentUrl: string,
    amount: number,
  ): Promise<boolean> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY no configurada: se salteó el envío del link de pago a ${to}.`,
      );
      return false;
    }

    const formattedAmount = new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(amount);

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Link de pago de tu sesión en Umbral - RCE',
      html: `
        <p>Hola ${patientName},</p>
        <p>Tu sesión tiene un cobro pendiente de ${formattedAmount}. Puedes pagarlo haciendo clic en el siguiente enlace:</p>
        <p><a href="${paymentUrl}">${paymentUrl}</a></p>
      `,
    });

    if (error) {
      this.logger.error(
        `Falló el envío del link de pago a ${to}: ${error.message}`,
      );
      return false;
    }

    return true;
  }

  // sdd/online-payment-integration PR 3 (T8.2): alerta única en la
  // transición PENDING -> LATE (spec.md "One-Shot Late-Payment
  // Notification") -- mismo contrato "nunca lanza" que el resto de la clase.
  // A diferencia de sendPaymentLinkEmail, no hay un campo persistido de
  // "delivery status" propio para el email de mora (solo Payment.
  // lateNotifiedAt, que PaymentsService ya setea como parte del mismo
  // updateMany count-gated que decide quién notifica) -- Promise<void> basta
  // acá.
  async sendLatePaymentEmail(
    to: string,
    patientName: string,
    amount: number,
    dueDate: Date,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY no configurada: se salteó el aviso de cobro vencido a ${to}.`,
      );
      return;
    }

    const formattedAmount = new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(amount);
    const formattedDueDate = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      dateStyle: 'long',
    }).format(dueDate);

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Tu cobro en Umbral - RCE está vencido',
      html: `
        <p>Hola ${patientName},</p>
        <p>El cobro de ${formattedAmount} correspondiente a tu sesión del ${formattedDueDate} sigue pendiente de pago.</p>
      `,
    });

    if (error) {
      this.logger.error(
        `Falló el envío del aviso de cobro vencido a ${to}: ${error.message}`,
      );
    }
  }
}
