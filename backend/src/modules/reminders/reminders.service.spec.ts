import { ConfigService } from '@nestjs/config';
import { RemindersService } from './reminders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';

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

describe('RemindersService.scan', () => {
  let prisma: {
    consultation: { findMany: jest.Mock };
    reminderDispatch: { create: jest.Mock; update: jest.Mock };
  };
  let notificationsService: { create: jest.Mock };
  let mailService: { sendSessionReminderEmail: jest.Mock };
  let config: { get: jest.Mock };
  let service: RemindersService;

  beforeEach(() => {
    prisma = {
      consultation: { findMany: jest.fn() },
      reminderDispatch: {
        create: jest.fn().mockResolvedValue({ id: 'dispatch-default' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    notificationsService = { create: jest.fn().mockResolvedValue(undefined) };
    mailService = {
      sendSessionReminderEmail: jest.fn().mockResolvedValue(undefined),
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
        where: expect.objectContaining({ deletedAt: null, correctedBy: null }),
      }),
    );
  });

  it('despacha un único offset due en ambos canales y marca el dispatch como SENT', async () => {
    const consultation = buildConsultation();
    prisma.consultation.findMany.mockResolvedValue([consultation]);

    await service.scan();

    expect(prisma.reminderDispatch.create).toHaveBeenCalledTimes(2);
    expect(notificationsService.create).toHaveBeenCalledTimes(1);
    expect(mailService.sendSessionReminderEmail).toHaveBeenCalledTimes(1);
    expect(prisma.reminderDispatch.update).toHaveBeenCalledTimes(2);
    expect(prisma.reminderDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
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
      (call) => (call[0] as CreateCallArgs).data,
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
      (call) => (call[0] as CreateCallArgs).data.status === 'SKIPPED',
    );
    expect(skippedCalls).toHaveLength(2);
    expect(
      skippedCalls.every(
        (call) => (call[0] as CreateCallArgs).data.offsetKind === 'H24',
      ),
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
        data: expect.objectContaining({ status: 'FAILED' }),
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
});
