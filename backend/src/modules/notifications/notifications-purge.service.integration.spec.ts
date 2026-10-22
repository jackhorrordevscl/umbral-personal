import * as argon2 from 'argon2';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsPurgeService } from './notifications-purge.service';

const DAY_MS = 24 * 60 * 60 * 1000;

// Issue #501 (A4): la purga también borra las no leídas viejas. El `where` es
// un OR (leída vieja | no leída vieja), así que se prueba contra Postgres real.
describe('NotificationsPurgeService (integration, real Prisma)', () => {
  let prisma: PrismaService;
  let userId: string;
  const runId = Date.now();

  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    userId = (
      await prisma.user.create({
        data: {
          email: `notif-purge-${runId}@example.com`,
          passwordHash: await argon2.hash('TestPass123!'),
          name: 'Dra. Purga',
        },
      })
    ).id;
  }, 30000);

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const create = async (createdDaysAgo: number, readDaysAgo: number | null) =>
    (
      await prisma.notification.create({
        data: {
          userId,
          type: 'SESSION_REMINDER',
          title: 'título',
          body: 'cuerpo',
          createdAt: daysAgo(createdDaysAgo),
          readAt: readDaysAgo === null ? null : daysAgo(readDaysAgo),
        },
      })
    ).id;

  it('borra las leídas hace más de 30 días y las no leídas creadas hace más de 90; conserva el resto', async () => {
    const oldRead = await create(200, 100);
    const recentRead = await create(200, 5);
    const oldUnread = await create(120, null);
    const recentUnread = await create(60, null);

    const service = new NotificationsPurgeService(prisma, {
      get: () => undefined,
    } as unknown as ConfigService);
    await service.purge();

    const remaining = await prisma.notification.findMany({
      where: { userId },
      select: { id: true },
    });
    const ids = remaining.map((row) => row.id).sort();
    expect(ids).toEqual([recentRead, recentUnread].sort());
    expect(ids).not.toContain(oldRead);
    expect(ids).not.toContain(oldUnread);
  }, 30000);
});
