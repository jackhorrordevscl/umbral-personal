import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Debe responder antes que el timeout del health check de Render (5 s).
const DB_CHECK_TIMEOUT_MS = 5000;

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Issue #380: el health check de Render debe detectar que la base no
  // responde. No lleva guards: no hay ThrottlerGuard global (ver auth.controller)
  // y la ruta no expone datos. El detalle del fallo no sale en la respuesta.
  @Get()
  async check(): Promise<{ status: 'ok' }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('database check timed out')),
        DB_CHECK_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error' });
    } finally {
      clearTimeout(timer);
    }
  }
}
