import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { escapeHtml } from '../../common/utils/escape-html.util';
import { maskEmail } from '../../common/utils/mask-email.util';

// When isGuardian is set the email is addressed to a minor's legal guardian
// and names the patient (no clinical information).
export interface GuardianMailOptions {
  patientName?: string;
  isGuardian?: boolean;
}

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
        `RESEND_API_KEY no configurada: se salteó el envío del email de verificación a ${maskEmail(to)}.`,
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Verifica tu cuenta en Umbral - RCE',
      html: `
        <p>Hola ${escapeHtml(name)},</p>
        <p>Crea tu cuenta en Umbral - RCE haciendo clic en el siguiente enlace:</p>
        <p><a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a></p>
        <p>Si no creaste esta cuenta, puedes ignorar este email.</p>
      `,
    });

    if (error) {
      // No se relanza como excepción HTTP: el signup ya persistió la cuenta,
      // y el remitente puede reintentar el envío más adelante (T-futuro:
      // reenviar verificación) sin perder el registro. Se deja constancia en
      // logs para que quede visible en monitoreo.
      this.logger.error(
        `Falló el envío del email de verificación a ${maskEmail(to)}: ${error.message}`,
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
        `RESEND_API_KEY no configurada: se salteó el envío del email de restablecimiento a ${maskEmail(to)}.`,
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Restablece tu contraseña en Umbral - RCE',
      html: `
        <p>Hola ${escapeHtml(name)},</p>
        <p>Restablece tu contraseña haciendo clic en el siguiente enlace (válido por 30 minutos):</p>
        <p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
        <p>Si no solicitaste este cambio, puedes ignorar este email; tu contraseña actual sigue siendo válida.</p>
      `,
    });

    if (error) {
      // Mismo motivo que sendVerificationEmail: no se relanza como excepción
      // HTTP, forgotPassword ya respondió el mensaje genérico al cliente.
      this.logger.error(
        `Falló el envío del email de restablecimiento a ${maskEmail(to)}: ${error.message}`,
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
        `RESEND_API_KEY no configurada: se salteó el envío del email de confirmación de cambio de email a ${maskEmail(to)}.`,
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Confirma tu nuevo email en Umbral - RCE',
      html: `
        <p>Hola ${escapeHtml(name)},</p>
        <p>Confirma tu nueva dirección de email en Umbral - RCE haciendo clic en el siguiente enlace (válido por 24 horas):</p>
        <p><a href="${escapeHtml(confirmUrl)}">${escapeHtml(confirmUrl)}</a></p>
        <p>Si no solicitaste este cambio, puedes ignorar este email; tu dirección actual sigue siendo válida.</p>
      `,
    });

    if (error) {
      this.logger.error(
        `Falló el envío del email de confirmación de cambio de email a ${maskEmail(to)}: ${error.message}`,
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
        `RESEND_API_KEY no configurada: se salteó el envío de la notificación de cambio de email a ${maskEmail(to)}.`,
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Se solicitó un cambio de email en tu cuenta de Umbral - RCE',
      html: `
        <p>Hola ${escapeHtml(name)},</p>
        <p>Se solicitó cambiar el email de tu cuenta a <strong>${escapeHtml(newEmail)}</strong>. El cambio no se aplica hasta que se confirme desde esa nueva dirección.</p>
        <p>Si no solicitaste este cambio, contacta a soporte lo antes posible.</p>
      `,
    });

    if (error) {
      this.logger.error(
        `Falló el envío de la notificación de cambio de email a ${maskEmail(to)}: ${error.message}`,
      );
    }
  }

  // Issue #302: aviso al dueño de la cuenta cuando MFA se desactiva con un
  // código de recuperación (y sus sesiones se cierran). Mismo contrato "nunca
  // lanza" que el resto de esta clase: la recuperación ya está hecha y un
  // fallo de Resend no debe deshacerla. IP y user-agent vienen del request
  // (controlados por el cliente), por eso se escapan igual que los nombres.
  async sendMfaRecoveryNoticeEmail(
    to: string,
    name: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY no configurada: se salteó el aviso de recuperación de MFA a ${maskEmail(to)}.`,
      );
      return;
    }

    const origin = [
      ipAddress ? `IP: ${escapeHtml(ipAddress)}` : null,
      userAgent ? `Dispositivo: ${escapeHtml(userAgent)}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join('<br />');

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject:
        'Se desactivó la verificación en dos pasos de tu cuenta de Umbral - RCE',
      html: `
        <p>Hola ${escapeHtml(name)},</p>
        <p>La verificación en dos pasos (MFA) de tu cuenta se desactivó usando un código de recuperación. Por seguridad, cerramos todas tus sesiones abiertas.</p>
        ${origin ? `<p>${origin}</p>` : ''}
        <p>Si fuiste tú, vuelve a habilitar MFA cuanto antes. Si no fuiste tú, cambia tu contraseña y contacta a soporte lo antes posible.</p>
      `,
    });

    if (error) {
      this.logger.error(
        `Falló el envío del aviso de recuperación de MFA a ${maskEmail(to)}: ${error.message}`,
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
  //
  // issue #163: devuelve el id de Resend (o null si no se configuró
  // RESEND_API_KEY, o si Resend respondió error) para que
  // RemindersService.claimAndDispatch lo persista en
  // ReminderDispatch.resendMessageId -- es la clave de correlación con el
  // webhook de entrega/apertura (POST /webhooks/resend). El contrato "nunca
  // lanza" se mantiene igual, solo cambia qué devuelve en éxito.
  // issue #286: RemindersService trata el null como envío fallido (FAILED, con
  // reintento acotado), no como SENT.
  async sendSessionReminderEmail(
    to: string,
    therapistName: string,
    patientFullName: string,
    when: Date,
    offsetLabel: string,
  ): Promise<string | null> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY no configurada: se salteó el recordatorio de sesión (${offsetLabel}) a ${maskEmail(to)}.`,
      );
      return null;
    }

    // Zona horaria fija a propósito (America/Santiago, mismo criterio que
    // design.md "UTC instant arithmetic; explicit render zone"): esta clase
    // solo renderiza texto humano, nunca decide due-ness.
    const formattedWhen = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(when);

    const { data, error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: `Recordatorio de sesión en ${offsetLabel}`,
      html: `
        <p>Hola ${escapeHtml(therapistName)},</p>
        <p>Tu sesión con <strong>${escapeHtml(patientFullName)}</strong> está programada para ${escapeHtml(formattedWhen)} (en ${escapeHtml(offsetLabel)}).</p>
      `,
    });

    if (error) {
      this.logger.error(
        `Falló el envío del recordatorio de sesión a ${maskEmail(to)}: ${error.message}`,
      );
      return null;
    }

    return data?.id ?? null;
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
    options?: GuardianMailOptions,
  ): Promise<boolean> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY no configurada: se salteó el envío del link de pago a ${maskEmail(to)}.`,
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
      html: options?.isGuardian
        ? `
        <p>Hola ${escapeHtml(patientName)},</p>
        <p>Le escribimos por el pago de las sesiones de ${escapeHtml(options.patientName ?? '')}. Hay un cobro pendiente de ${escapeHtml(formattedAmount)}. Puede pagarlo haciendo clic en el siguiente enlace:</p>
        <p><a href="${escapeHtml(paymentUrl)}">${escapeHtml(paymentUrl)}</a></p>
      `
        : `
        <p>Hola ${escapeHtml(patientName)},</p>
        <p>Tu sesión tiene un cobro pendiente de ${escapeHtml(formattedAmount)}. Puedes pagarlo haciendo clic en el siguiente enlace:</p>
        <p><a href="${escapeHtml(paymentUrl)}">${escapeHtml(paymentUrl)}</a></p>
      `,
    });

    if (error) {
      this.logger.error(
        `Falló el envío del link de pago a ${maskEmail(to)}: ${error.message}`,
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
    options?: GuardianMailOptions,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY no configurada: se salteó el aviso de cobro vencido a ${maskEmail(to)}.`,
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
      html: options?.isGuardian
        ? `
        <p>Hola ${escapeHtml(patientName)},</p>
        <p>Le escribimos por el cobro de las sesiones de ${escapeHtml(options.patientName ?? '')}. El cobro de ${escapeHtml(formattedAmount)} correspondiente a la sesión del ${escapeHtml(formattedDueDate)} sigue pendiente de pago.</p>
      `
        : `
        <p>Hola ${escapeHtml(patientName)},</p>
        <p>El cobro de ${escapeHtml(formattedAmount)} correspondiente a tu sesión del ${escapeHtml(formattedDueDate)} sigue pendiente de pago.</p>
      `,
    });

    if (error) {
      this.logger.error(
        `Falló el envío del aviso de cobro vencido a ${maskEmail(to)}: ${error.message}`,
      );
    }
  }
}
