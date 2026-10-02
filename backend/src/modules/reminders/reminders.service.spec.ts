import { ConfigService } from '@nestjs/config';
import { RemindersService } from './reminders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import * as constants from './reminders.constants';
import {
  REMINDER_MAX_ATTEMPTS,
  REMINDER_PENDING_STALE_MS,
} from './reminders.constants';

// sdd/session-reminders PR 2 (T5.2, T6.3-T6.10): due-ness ya está probada de
// forma pura en reminders.util.spec.ts -- estos tests cubren la capa de
// aplicación: la query de scan, el claim-then-send vía @@unique (P2002), y
// que los canales IN_APP/EMAIL se despachen de forma independiente. Prisma,
// NotificationsService y MailService se mockean acá (≤4 mocks) porque son
// infraestructura real (DB, HTTP); el due-ness que decide QUÉ despachar ya
// no vive en este archivo.
interface MockConsultation {
  id: string;
  groupId: string;
  patientId: string;
  sessionDate: Date;
  therapistId: string;
  patient: { fullName: string };
  therapist: { name: string; email: string };
}

function buildConsultation(
  overrides: Partial<MockConsultation> = {},
): MockConsultation {
  return {
    id: 'consultation-1',
    groupId: 'group-1',
    patientId: 'patient-1',
    sessionDate: new Date(Date.now() + 10 * 60 * 60 * 1000),
    therapistId: 'therapist-1',
    patient: { fullName: 'Juan Soto' },
    therapist: { name: 'Dra. Pérez', email: 'therapist@example.com' },
    ...overrides,
  };
}

function uniqueViolation(): { code: string } {
  return { code: 'P2002' };
}

interface CreateCallArgs {
  data: {
    status: string;
    offsetKind: string;
    channel: string;
    sessionDate: Date;
  };
}

interface UpdateCallArgs {
  data: { status: string };
}

interface ActionableBand {
  sessionDate: { gt: Date; lte: Date };
  OR: {
    NOT: {
      AND: {
        reminderDispatches: { some: { offsetKind: string; channel: string } };
      }[];
    };
  }[];
}

// Tipos de offset que una rama OR exige tener reclamados en todos los canales.
function offsetKindsOf(branch: ActionableBand['OR'][number]): string[] {
  return [
    ...new Set(branch.NOT.AND.map((c) => c.reminderDispatches.some.offsetKind)),
  ];
}

describe('RemindersService.scan', () => {
  let prisma: {
    consultation: { findMany: jest.Mock };
    reminderDispatch: {
      create: jest.Mock<Promise<{ id: string }>, [CreateCallArgs]>;
      update: jest.Mock<Promise<unknown>, [UpdateCallArgs]>;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let notificationsService: { create: jest.Mock };
  let mailService: { sendSessionReminderEmail: jest.Mock };
  let config: { get: jest.Mock };
  let service: RemindersService;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    prisma = {
      consultation: { findMany: jest.fn() },
      reminderDispatch: {
        create: jest
          .fn<Promise<{ id: string }>, [CreateCallArgs]>()
          .mockResolvedValue({ id: 'dispatch-default' }),
        update: jest
          .fn<Promise<unknown>, [UpdateCallArgs]>()
          .mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    notificationsService = { create: jest.fn().mockResolvedValue(undefined) };
    mailService = {
      sendSessionReminderEmail: jest.fn().mockResolvedValue('resend-default'),
    };
    // Ausente => habilitado por default (design.md, T4.5).
    config = { get: jest.fn().mockReturnValue(undefined) };
    service = new RemindersService(
      prisma as unknown as PrismaService,
      notificationsService as unknown as NotificationsService,
      mailService as unknown as MailService,
      config as unknown as ConfigService,
    );
  });

  it('no escanea si REMINDERS_ENABLED="false" (harness de runtime)', async () => {
    config.get.mockReturnValue('false');
    service = new RemindersService(
      prisma as unknown as PrismaService,
      notificationsService as unknown as NotificationsService,
      mailService as unknown as MailService,
      config as unknown as ConfigService,
    );

    await service.scan();

    expect(prisma.consultation.findMany).not.toHaveBeenCalled();
  });

  it('excluye sesiones eliminadas y versiones superadas en la query de scan', async () => {
    prisma.consultation.findMany.mockResolvedValue([]);

    await service.scan();

    expect(prisma.consultation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          correctedBy: null,
        }) as { deletedAt: null; correctedBy: null },
      }),
    );
  });

  it('excluye sesiones de pacientes con soft-delete en la query de scan', async () => {
    prisma.consultation.findMany.mockResolvedValue([]);

    await service.scan();

    expect(prisma.consultation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient: { deletedAt: null },
        }) as { patient: { deletedAt: null } },
      }),
    );
  });

  // issue #286 (parte 2): este mock no valida el filtro contra SQL real (eso lo
  // cubre reminders.service.integration.spec.ts); solo fija su forma.
  it('filtra solo consultas accionables: por tramo, algún offset due sin fila en algún canal', async () => {
    prisma.consultation.findMany.mockResolvedValue([]);

    await service.scan();

    const args = (
      prisma.consultation.findMany.mock.calls as {
        where: { OR: ActionableBand[] };
      }[][]
    )[0][0];
    expect(args.where.OR).toHaveLength(2);

    const [h2Band, h24Band] = args.where.OR;
    // Tramo cercano (<= 2h): H2 se despacha y H24 queda SKIPPED => ambos cuentan.
    expect(h2Band.OR.map(offsetKindsOf)).toEqual([['H2'], ['H24']]);
    // Tramo lejano (2h-24h): solo H24 está due.
    expect(h24Band.OR.map(offsetKindsOf)).toEqual([['H24']]);
    // Cada offset exige una fila por canal para considerarse reclamado.
    expect(h24Band.OR[0].NOT.AND).toEqual([
      {
        reminderDispatches: { some: { offsetKind: 'H24', channel: 'IN_APP' } },
      },
      { reminderDispatches: { some: { offsetKind: 'H24', channel: 'EMAIL' } } },
    ]);
    // Los tramos son contiguos: el límite superior del cercano es el inferior
    // del lejano.
    expect(h2Band.sessionDate.lte).toEqual(h24Band.sessionDate.gt);
  });

  it('pagina con cursor (sessionDate, id) hasta agotar la ventana más allá de SCAN_BATCH_LIMIT', async () => {
    jest.replaceProperty(constants, 'SCAN_BATCH_LIMIT', 2);
    const c1 = buildConsultation({ id: 'c1', groupId: 'g1' });
    const c2 = buildConsultation({ id: 'c2', groupId: 'g2' });
    const c3 = buildConsultation({ id: 'c3', groupId: 'g3' });
    prisma.consultation.findMany
      .mockResolvedValueOnce([c1, c2])
      .mockResolvedValueOnce([c3]);

    await service.scan();

    expect(prisma.consultation.findMany).toHaveBeenCalledTimes(2);
    const calls = prisma.consultation.findMany.mock.calls as {
      orderBy: unknown;
      cursor?: unknown;
      skip?: number;
    }[][];
    expect(calls[0][0].orderBy).toEqual([
      { sessionDate: 'asc' },
      { id: 'asc' },
    ]);
    expect(calls[0][0].cursor).toBeUndefined();
    expect(calls[1][0].cursor).toEqual({ id: 'c2' });
    expect(calls[1][0].skip).toBe(1);
    // Las tres consultas se procesan (2 canales cada una).
    expect(prisma.reminderDispatch.create).toHaveBeenCalledTimes(6);
  });

  it('no pide más páginas si la última vino incompleta', async () => {
    prisma.consultation.findMany.mockResolvedValue([buildConsultation()]);

    await service.scan();

    expect(prisma.consultation.findMany).toHaveBeenCalledTimes(1);
  });

  it('la notificación in-app muestra la fecha de la sesión en hora de Santiago, no el ISO en UTC (issue #288)', async () => {
    const consultation = buildConsultation();
    prisma.consultation.findMany.mockResolvedValue([consultation]);

    await service.scan();

    const expectedWhen = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(consultation.sessionDate);
    const [arg] = notificationsService.create.mock.calls[0] as [
      { body: string },
    ];
    expect(arg.body).toContain(expectedWhen);
    expect(arg.body).not.toContain(consultation.sessionDate.toISOString());
  });

  it('corta en SCAN_MAX_PAGES aunque cada página venga llena', async () => {
    jest.replaceProperty(constants, 'SCAN_BATCH_LIMIT', 1);
    prisma.consultation.findMany.mockResolvedValue([
      buildConsultation({ id: 'c1' }),
    ]);
    // Todo ya reclamado: el cursor es lo único que avanza.
    prisma.reminderDispatch.create.mockRejectedValue(uniqueViolation());

    await service.scan();

    expect(prisma.consultation.findMany).toHaveBeenCalledTimes(
      constants.SCAN_MAX_PAGES,
    );
  });

  it('despacha un único offset due en ambos canales y marca el dispatch como SENT', async () => {
    const consultation = buildConsultation();
    prisma.consultation.findMany.mockResolvedValue([consultation]);

    await service.scan();

    expect(prisma.reminderDispatch.create).toHaveBeenCalledTimes(2);
    expect(notificationsService.create).toHaveBeenCalledTimes(1);
    // linkPath debe traer patientId + consultationId como query params -- la
    // ruta real (/consultations, ver App.tsx) no tiene :id, así que
    // ConsultationsPage necesita ambos para preseleccionar el paciente y
    // abrir el modal de Corregir sesión.
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        linkPath: `/consultations?patientId=${consultation.patientId}&consultationId=${consultation.id}`,
      }),
    );
    expect(mailService.sendSessionReminderEmail).toHaveBeenCalledTimes(1);
    expect(prisma.reminderDispatch.update).toHaveBeenCalledTimes(2);
    expect(prisma.reminderDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }) as {
          status: string;
        },
      }),
    );
  });

  // issue #163: RemindersService.claimAndDispatch persiste el id devuelto
  // por MailService.sendSessionReminderEmail en la misma actualización que
  // marca el dispatch como SENT -- es la clave de correlación que el
  // webhook de Resend (POST /webhooks/resend) usa para setear
  // deliveredAt/openedAt más tarde.
  it('persiste el resendMessageId devuelto por MailService en el update a SENT del canal EMAIL (issue #163)', async () => {
    mailService.sendSessionReminderEmail.mockResolvedValue('resend-email-1');
    const consultation = buildConsultation();
    prisma.consultation.findMany.mockResolvedValue([consultation]);

    await service.scan();

    expect(prisma.reminderDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SENT',
          resendMessageId: 'resend-email-1',
        }) as { status: string; resendMessageId: string },
      }),
    );
  });

  it('marca el dispatch EMAIL como FAILED (no SENT) cuando MailService devuelve null, y el IN_APP queda SENT (issue #286)', async () => {
    mailService.sendSessionReminderEmail.mockResolvedValue(null);
    const consultation = buildConsultation();
    prisma.consultation.findMany.mockResolvedValue([consultation]);

    await service.scan();

    const updates = prisma.reminderDispatch.update.mock.calls.map(
      (call) => call[0].data as { status: string; error?: string },
    );
    expect(updates.filter((d) => d.status === 'SENT')).toHaveLength(1);
    const failed = updates.filter((d) => d.status === 'FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toContain('no confirmó el envío');
  });

  it('re-arma ambos offsets cuando correct() mueve sessionDate: 4 filas nuevas de ReminderDispatch (T6.3/T6.4)', async () => {
    // Reprogramada a 10 minutos: H24 y H2 quedan simultáneamente due => 2
    // offsets x 2 canales = 4 filas nuevas (mezcla de SKIPPED + PENDING).
    const consultation = buildConsultation({
      sessionDate: new Date(Date.now() + 10 * 60 * 1000),
    });
    prisma.consultation.findMany.mockResolvedValue([consultation]);

    await service.scan();

    expect(prisma.reminderDispatch.create).toHaveBeenCalledTimes(4);
    const calls = prisma.reminderDispatch.create.mock.calls.map(
      (call) => call[0].data,
    );
    expect(
      calls.filter((d) => d.offsetKind === 'H24' && d.status === 'SKIPPED'),
    ).toHaveLength(2);
    expect(
      calls.filter((d) => d.offsetKind === 'H2' && d.status === 'PENDING'),
    ).toHaveLength(2);
    expect(calls.every((d) => d.sessionDate === consultation.sessionDate)).toBe(
      true,
    );
  });

  it('una corrección de solo texto (sessionDate sin cambios) no produce despachos nuevos: la clave ya está reclamada (T6.3/T6.4)', async () => {
    const consultation = buildConsultation();
    prisma.consultation.findMany.mockResolvedValue([consultation]);
    prisma.reminderDispatch.create.mockRejectedValue(uniqueViolation());

    await service.scan();

    expect(notificationsService.create).not.toHaveBeenCalled();
    expect(mailService.sendSessionReminderEmail).not.toHaveBeenCalled();
  });

  it('un P2002 al reclamar el dispatch salta silenciosamente sin enviar el email (T6.5/T6.6)', async () => {
    const consultation = buildConsultation();
    prisma.consultation.findMany.mockResolvedValue([consultation]);
    prisma.reminderDispatch.create.mockRejectedValue(uniqueViolation());

    await expect(service.scan()).resolves.toBeUndefined();
    expect(mailService.sendSessionReminderEmail).not.toHaveBeenCalled();
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('si ambos offsets están due simultáneamente, solo H2 se despacha (una vez por canal) y H24 queda SKIPPED (T6.7/T6.8)', async () => {
    const consultation = buildConsultation({
      sessionDate: new Date(Date.now() + 10 * 60 * 1000),
    });
    prisma.consultation.findMany.mockResolvedValue([consultation]);

    await service.scan();

    expect(notificationsService.create).toHaveBeenCalledTimes(1);
    expect(mailService.sendSessionReminderEmail).toHaveBeenCalledTimes(1);
    const skippedCalls = prisma.reminderDispatch.create.mock.calls.filter(
      (call) => call[0].data.status === 'SKIPPED',
    );
    expect(skippedCalls).toHaveLength(2);
    expect(
      skippedCalls.every((call) => call[0].data.offsetKind === 'H24'),
    ).toBe(true);
  });

  it('si el envío de email lanza, la notificación in-app igual se crea exactamente una vez (canales independientes, T6.9/T6.10)', async () => {
    const consultation = buildConsultation();
    prisma.consultation.findMany.mockResolvedValue([consultation]);
    mailService.sendSessionReminderEmail.mockRejectedValue(
      new Error('provider down'),
    );

    await expect(service.scan()).resolves.toBeUndefined();

    expect(notificationsService.create).toHaveBeenCalledTimes(1);
    expect(prisma.reminderDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }) as {
          status: string;
        },
      }),
    );
  });

  it('sin RESEND_API_KEY, la notificación in-app igual se crea (MailService real con cliente nulo, T6.9/T6.10)', async () => {
    const realMailService = new MailService({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);
    service = new RemindersService(
      prisma as unknown as PrismaService,
      notificationsService as unknown as NotificationsService,
      realMailService,
      config as unknown as ConfigService,
    );
    const consultation = buildConsultation();
    prisma.consultation.findMany.mockResolvedValue([consultation]);

    await service.scan();

    expect(notificationsService.create).toHaveBeenCalledTimes(1);
  });

  describe('reintentos acotados (issue #286)', () => {
    interface RetryRowOverrides {
      id?: string;
      status?: 'FAILED' | 'PENDING';
      attempts?: number;
      channel?: 'IN_APP' | 'EMAIL';
      offsetKind?: 'H24' | 'H2';
      sessionDate?: Date;
    }

    function retryRow(overrides: RetryRowOverrides = {}) {
      const consultation = buildConsultation();
      return {
        id: 'dispatch-retry-1',
        consultationId: consultation.id,
        status: 'FAILED' as const,
        attempts: 1,
        channel: 'EMAIL' as const,
        offsetKind: 'H24' as const,
        ...overrides,
        sessionDate: overrides.sessionDate ?? consultation.sessionDate,
        consultation,
      };
    }

    it('consulta FAILED o PENDING abandonado bajo el tope, solo de sesiones futuras y vigentes', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);

      await service.scan();

      expect(prisma.reminderDispatch.findMany).toHaveBeenCalledTimes(1);
      const calls = prisma.reminderDispatch.findMany.mock.calls as unknown[][];
      const args = calls[0][0] as {
        where: {
          attempts: { lt: number };
          OR: Array<{ status: string; claimedAt?: { lt: Date } }>;
          consultation: Record<string, unknown>;
        };
      };
      expect(args.where.attempts).toEqual({ lt: REMINDER_MAX_ATTEMPTS });
      expect(args.where.OR.map((c) => c.status)).toEqual(['FAILED', 'PENDING']);
      const staleCutoff = args.where.OR[1].claimedAt?.lt as Date;
      expect(Date.now() - staleCutoff.getTime()).toBeGreaterThanOrEqual(
        REMINDER_PENDING_STALE_MS,
      );
      expect(args.where.consultation).toEqual(
        expect.objectContaining({
          deletedAt: null,
          correctedBy: null,
          patient: { deletedAt: null },
        }),
      );
    });

    it('reintenta un FAILED bajo el tope: re-reclama con attempts+1 y reenvía con la etiqueta de su offset', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.reminderDispatch.findMany.mockResolvedValue([
        retryRow({ offsetKind: 'H2' }),
      ]);

      await service.scan();

      expect(prisma.reminderDispatch.updateMany).toHaveBeenCalledWith({
        where: { id: 'dispatch-retry-1', status: 'FAILED', attempts: 1 },
        data: expect.objectContaining({
          status: 'PENDING',
          attempts: { increment: 1 },
          error: null,
        }) as object,
      });
      expect(mailService.sendSessionReminderEmail).toHaveBeenCalledWith(
        'therapist@example.com',
        'Dra. Pérez',
        'Juan Soto',
        expect.any(Date),
        '2 horas',
      );
      expect(prisma.reminderDispatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dispatch-retry-1' },
          data: expect.objectContaining({
            status: 'SENT',
            resendMessageId: 'resend-default',
          }) as object,
        }),
      );
    });

    it('un reintento que vuelve a fallar queda FAILED', async () => {
      mailService.sendSessionReminderEmail.mockResolvedValue(null);
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.reminderDispatch.findMany.mockResolvedValue([
        retryRow({ attempts: 2 }),
      ]);

      await service.scan();

      expect(prisma.reminderDispatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }) as object,
        }),
      );
    });

    it('re-reclama un PENDING abandonado con su status y attempts como candado optimista', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.reminderDispatch.findMany.mockResolvedValue([
        retryRow({ status: 'PENDING', attempts: 2, channel: 'IN_APP' }),
      ]);

      await service.scan();

      expect(prisma.reminderDispatch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dispatch-retry-1', status: 'PENDING', attempts: 2 },
        }),
      );
      expect(notificationsService.create).toHaveBeenCalledTimes(1);
      expect(mailService.sendSessionReminderEmail).not.toHaveBeenCalled();
    });

    it('no envía si pierde la carrera del re-claim (updateMany count 0)', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.reminderDispatch.findMany.mockResolvedValue([retryRow()]);
      prisma.reminderDispatch.updateMany.mockResolvedValue({ count: 0 });

      await service.scan();

      expect(mailService.sendSessionReminderEmail).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(prisma.reminderDispatch.update).not.toHaveBeenCalled();
    });

    it('ignora filas cuya sessionDate ya no coincide con la de la consulta (reprogramada)', async () => {
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.reminderDispatch.findMany.mockResolvedValue([
        retryRow({ sessionDate: new Date(Date.now() + 99 * 60 * 60 * 1000) }),
      ]);

      await service.scan();

      expect(prisma.reminderDispatch.updateMany).not.toHaveBeenCalled();
      expect(mailService.sendSessionReminderEmail).not.toHaveBeenCalled();
    });

    it('no consulta reintentos si REMINDERS_ENABLED="false"', async () => {
      config.get.mockReturnValue('false');
      service = new RemindersService(
        prisma as unknown as PrismaService,
        notificationsService as unknown as NotificationsService,
        mailService as unknown as MailService,
        config as unknown as ConfigService,
      );

      await service.scan();

      expect(prisma.reminderDispatch.findMany).not.toHaveBeenCalled();
    });
  });
});
