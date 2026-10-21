import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { isMinor } from '../../common/utils/age.util';

interface Recipient {
  email: string;
  fullName: string;
}

// T4b: avisa por email que el cierre del tratamiento canceló las consultas
// futuras. Corre después del commit, nunca lanza (el cierre ya es definitivo) y
// cada envío está aislado del resto. El aviso NO lleva el motivo del cierre.
//
// Destinatarios: el paciente adulto con email; para un NNA, solo los
// representantes que reciben comunicaciones y tienen email, nunca el email del
// propio NNA.
@Injectable()
export class DischargeCancellationNotifier {
  private readonly logger = new Logger(DischargeCancellationNotifier.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  async notify(dischargeId: string): Promise<void> {
    try {
      const cancelled = await this.prisma.consultation.findMany({
        where: { cancelledByDischargeId: dischargeId },
        select: { sessionDate: true },
        orderBy: { sessionDate: 'asc' },
      });
      if (cancelled.length === 0) return;

      const discharge = await this.prisma.treatmentDischarge.findUnique({
        where: { id: dischargeId },
        select: {
          patientId: true,
          therapist: { select: { name: true } },
          patient: {
            select: { fullName: true, email: true, birthDate: true },
          },
        },
      });
      if (!discharge) return;

      const recipients = await this.resolveRecipients(discharge);
      if (recipients.length === 0) {
        this.logger.warn(
          `Sin destinatario para el aviso de cancelación (dischargeId=${dischargeId}): ${cancelled.length} consulta(s) cancelada(s) sin email del paciente ni de un representante.`,
        );
        return;
      }

      const dates = cancelled.map((c) => c.sessionDate);
      for (const recipient of recipients) {
        try {
          await this.mailService.sendConsultationCancelledEmail(
            recipient.email,
            recipient.fullName,
            discharge.therapist.name,
            dates,
          );
        } catch (err) {
          this.logger.error(
            `Fallo al enviar el aviso de cancelación (dischargeId=${dischargeId}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Fallo al preparar el aviso de cancelación (dischargeId=${dischargeId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async resolveRecipients(discharge: {
    patientId: string;
    patient: { fullName: string; email: string | null; birthDate: Date };
  }): Promise<Recipient[]> {
    if (!isMinor(discharge.patient.birthDate)) {
      return discharge.patient.email
        ? [
            {
              email: discharge.patient.email,
              fullName: discharge.patient.fullName,
            },
          ]
        : [];
    }

    const guardians = await this.prisma.legalGuardian.findMany({
      where: {
        patientId: discharge.patientId,
        receivesCommunications: true,
        email: { not: null },
      },
      select: { fullName: true, email: true },
    });
    return guardians.flatMap((g) =>
      g.email ? [{ email: g.email, fullName: g.fullName }] : [],
    );
  }
}
