import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { logAuditFailOpen } from '../../common/utils/audit-fail-open.util';

// Intentos de segundo factor (TOTP o código de recuperación) que una cuenta
// admite dentro de la ventana antes de bloquearse.
const MAX_ATTEMPTS = 5;

// Pasada la ventana sin intentos, el contador vuelve a cero.
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

// Espera que sigue a cada intento sobre el tope: 1, 5, 15 y 60 minutos (la
// última se repite).
const LOCK_BACKOFF_MS = [1, 5, 15, 60].map((minutes) => minutes * 60 * 1000);

const LOCKED_MESSAGE =
  'Demasiados intentos fallidos. Intenta de nuevo en unos minutos.';

// Issue #487: los límites por IP no frenan a quien reparte intentos entre
// muchas IPs con la contraseña ya conocida (el mfaToken dura 5 minutos).
// Este límite es por cuenta. Cada intento reserva su lugar con un incremento
// atómico ANTES de verificar el código, así una ráfaga de peticiones paralelas
// no puede probar más de MAX_ATTEMPTS códigos antes de que entre el bloqueo.
// Acertar el código limpia el contador (clear).
@Injectable()
export class MfaAttemptLimiter {
  private readonly logger = new Logger(MfaAttemptLimiter.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  /**
   * Reserva un intento. Los primeros MAX_ATTEMPTS pasan libres. Pasado el
   * tope, cada intento que entra arma el bloqueo siguiente (espera creciente)
   * y solo uno por espera puede entrar; el resto recibe 429. Un bloqueo
   * vigente rechaza sin reservar, para que reintentar no lo alargue.
   */
  async reserve(
    user: { id: string; mfaLockedUntil: Date | null },
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const now = new Date();
    if (user.mfaLockedUntil && user.mfaLockedUntil > now) {
      throw new ThrottlerException(LOCKED_MESSAGE);
    }

    await this.prisma.user.updateMany({
      where: {
        id: user.id,
        mfaFailedAt: { lt: new Date(now.getTime() - ATTEMPT_WINDOW_MS) },
      },
      data: { mfaFailedAttempts: 0, mfaFailedAt: null, mfaLockedUntil: null },
    });
    const { mfaFailedAttempts } = await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaFailedAttempts: { increment: 1 }, mfaFailedAt: now },
      select: { mfaFailedAttempts: true },
    });
    if (mfaFailedAttempts <= MAX_ATTEMPTS) return;

    const level = Math.min(
      mfaFailedAttempts - MAX_ATTEMPTS,
      LOCK_BACKOFF_MS.length,
    );
    const lockMs = LOCK_BACKOFF_MS[level - 1];
    // Pasado el tope solo entra un intento por espera: este compare-and-set
    // arma el bloqueo siguiente únicamente si no hay uno vigente, así que de
    // varias peticiones paralelas gana una y las demás reciben 429. Si el
    // código del que gana es correcto, clear() deja la cuenta en cero.
    const lockedUntil = new Date(now.getTime() + lockMs);
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ mfaLockedUntil: null }, { mfaLockedUntil: { lte: now } }],
      },
      data: { mfaLockedUntil: lockedUntil },
    });
    if (count !== 1) {
      throw new ThrottlerException(LOCKED_MESSAGE);
    }
    await logAuditFailOpen(this.auditService, this.logger, {
      userId: user.id,
      action: 'MFA_FAILED',
      resource: 'MFA',
      resourceId: user.id,
      detail: `Bloqueo de ${lockMs / 60000} min armado por intentos de segundo factor`,
      ipAddress,
      userAgent,
    });
  }

  /** El código fue correcto: la cuenta vuelve a empezar de cero. */
  async clear(userId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { mfaFailedAttempts: 0, mfaFailedAt: null, mfaLockedUntil: null },
    });
  }
}
