import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

// Issue #287: la tabla Session solo crecía -- cada login agrega una fila y
// nada las borraba nunca. Se purgan las sesiones expiradas o revocadas hace
// más de SESSION_PURGE_GRACE_MS (el margen conserva el historial reciente
// para soporte/auditoría de accesos).
export const SESSION_PURGE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_PURGE_BATCH_SIZE = 1000;
// Tope de seguridad por corrida: 100 lotes x 1000 filas. Si queda backlog, lo
// toma la corrida del día siguiente en vez de mantener la DB ocupada.
export const SESSION_PURGE_MAX_BATCHES = 100;

@Injectable()
export class SessionPurgeService {
  private readonly logger = new Logger(SessionPurgeService.name);
  private readonly enabled: boolean;
  private running = false;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    // Ausente => habilitado por default (mismo criterio que
    // RemindersService/PaymentReconciliationService): solo un "false"
    // explícito lo desactiva.
    this.enabled = this.config.get<string>('SESSION_PURGE_ENABLED') !== 'false';

    if (!this.enabled) {
      this.logger.warn(
        'SESSION_PURGE_ENABLED="false": la purga de sesiones antiguas queda deshabilitada.',
      );
    }
  }

  // 04:00 diario según la zona horaria del servidor (UTC en Render), fuera del
  // horario de atención. Nunca lanza: un fallo se registra y la próxima
  // corrida reintenta.
  @Cron('0 4 * * *')
  async purge(): Promise<void> {
    if (!this.enabled) return;

    // Guard de reentrada: si una corrida anterior sigue en curso (tabla muy
    // grande), esta se omite en vez de solaparse.
    if (this.running) {
      this.logger.warn(
        'Purga de sesiones omitida: la corrida anterior sigue en curso.',
      );
      return;
    }

    this.running = true;
    try {
      const cutoff = new Date(Date.now() - SESSION_PURGE_GRACE_MS);
      let deleted = 0;

      for (let batch = 0; batch < SESSION_PURGE_MAX_BATCHES; batch++) {
        const rows = await this.prisma.session.findMany({
          where: {
            OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
          },
          select: { id: true },
          take: SESSION_PURGE_BATCH_SIZE,
        });
        if (rows.length === 0) break;

        const result = await this.prisma.session.deleteMany({
          where: { id: { in: rows.map((row) => row.id) } },
        });
        deleted += result.count;

        if (rows.length < SESSION_PURGE_BATCH_SIZE) break;
      }

      this.logger.log(`Purga de sesiones: ${deleted} filas eliminadas.`);
    } catch (err) {
      this.logger.error(
        `Purga de sesiones falló: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
