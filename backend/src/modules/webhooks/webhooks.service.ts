import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

// issue #163: Resend firma sus webhooks con el esquema estándar Svix
// (https://docs.svix.com/receiving/verifying-payloads/how). El payload real
// trae más campos (email, subject, created_at, etc.); solo se tipan los que
// esta clase realmente lee -- el resto es ignorado a propósito (out of
// scope, ver odd/tasks/issue-163-email-delivery-tracking.md).
export interface ResendWebhookPayload {
  type: string;
  data?: {
    email_id?: string;
  };
}

interface SvixHeaders {
  'svix-id': string;
  'svix-timestamp': string;
  'svix-signature': string;
}

const DELIVERED_EVENT = 'email.delivered';
const OPENED_EVENT = 'email.opened';

// Tolerancia de 5 minutos entre el timestamp firmado y "ahora" -- mismo
// valor que usa la librería de referencia (standardwebhooks, la que usa
// `svix` por debajo) para el esquema Standard Webhooks. Sin esto, una firma
// robada seguiría siendo válida indefinidamente (replay).
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly secretBytes: Buffer | null;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    const secret = this.config.get<string>('RESEND_WEBHOOK_SECRET');
    // Sin RESEND_WEBHOOK_SECRET (dev/test sin el webhook configurado en
    // Resend) el endpoint degrada a 501 en el controller en vez de intentar
    // verificar una firma sin secret -- mismo criterio "no configurado =>
    // degrada, no rompe boot" que MailService sin RESEND_API_KEY.
    this.secretBytes = secret ? WebhooksService.decodeSecret(secret) : null;
  }

  private static decodeSecret(secret: string): Buffer {
    // Los secrets de Resend/Svix vienen con el prefijo "whsec_" seguido del
    // material en base64 -- se acepta también sin el prefijo por robustez.
    const withoutPrefix = secret.startsWith('whsec_')
      ? secret.slice('whsec_'.length)
      : secret;
    return Buffer.from(withoutPrefix, 'base64');
  }

  isConfigured(): boolean {
    return this.secretBytes !== null;
  }

  // Implementa la verificación del esquema Standard Webhooks
  // (https://www.standardwebhooks.com/), el mismo que usa la librería `svix`
  // por debajo y que Resend firma con sus headers svix-id/svix-timestamp/
  // svix-signature. Reimplementado con Node `crypto` en vez de depender del
  // paquete npm `svix`: su build es ESM-only (sin export CJS), y este
  // backend corre Jest sobre ts-jest en modo CommonJS -- `require('svix')`
  // falla con "Cannot use import statement outside a module" al intentar
  // cargar su dist/index.mjs. El algoritmo es público y estable (HMAC-SHA256
  // sobre "{id}.{timestamp}.{payload}", ver node_modules del propio paquete
  // svix para la referencia), así que reimplementarlo evita el conflicto de
  // ESM/CJS sin cambiar el contrato de verificación.
  verifySignature(rawBody: Buffer, headers: SvixHeaders): boolean {
    if (!this.secretBytes) return false;

    const id = headers['svix-id'];
    const timestamp = headers['svix-timestamp'];
    const signatureHeader = headers['svix-signature'];
    if (!id || !timestamp || !signatureHeader) return false;

    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds)) return false;
    const skewMs = Math.abs(Date.now() - timestampSeconds * 1000);
    if (skewMs > TIMESTAMP_TOLERANCE_MS) return false;

    const signedContent = `${id}.${timestamp}.${rawBody.toString('utf-8')}`;
    const expectedSignature = createHmac('sha256', this.secretBytes)
      .update(signedContent, 'utf-8')
      .digest();

    // svix-signature puede traer varias firmas espacio-separadas (rotación
    // de secret) -- basta con que una matchee.
    return signatureHeader.split(' ').some((candidate) => {
      const [version, encodedSig] = candidate.split(',');
      if (version !== 'v1' || !encodedSig) return false;
      let candidateSig: Buffer;
      try {
        candidateSig = Buffer.from(encodedSig, 'base64');
      } catch {
        return false;
      }
      return (
        candidateSig.length === expectedSignature.length &&
        timingSafeEqual(candidateSig, expectedSignature)
      );
    });
  }

  // issue #163: email.delivered/email.opened correlacionan con
  // ReminderDispatch vía resendMessageId (el id que Resend devolvió al
  // enviar, ver MailService.sendSessionReminderEmail). Cualquier otro
  // evento (email.sent, email.bounced, email.complained, etc.), o un
  // email_id sin ReminderDispatch asociado (p. ej. un email de otro flujo,
  // fuera de este alcance), es un no-op silencioso -- nunca un error. El
  // webhook debe ser idempotente porque Resend puede reenviar el mismo
  // evento más de una vez.
  async handleEvent(payload: ResendWebhookPayload): Promise<void> {
    const emailId = payload?.data?.email_id;
    if (!emailId) return;

    let field: 'deliveredAt' | 'openedAt';
    if (payload.type === DELIVERED_EVENT) {
      field = 'deliveredAt';
    } else if (payload.type === OPENED_EVENT) {
      field = 'openedAt';
    } else {
      return;
    }

    const dispatch = await this.prisma.reminderDispatch.findFirst({
      where: { resendMessageId: emailId },
    });
    if (!dispatch) {
      this.logger.debug(
        `Webhook de Resend (${payload.type}) sin ReminderDispatch asociado para email_id=${emailId} -- ignorado.`,
      );
      return;
    }

    // No pisa un timestamp real ya seteado -- Resend puede reenviar el
    // mismo evento, y un reenvío posterior no debe mover la marca de tiempo
    // hacia adelante.
    if (dispatch[field]) return;

    await this.prisma.reminderDispatch.update({
      where: { id: dispatch.id },
      data: { [field]: new Date() },
    });
  }
}
