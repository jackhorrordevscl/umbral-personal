import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { RemindersService } from './reminders.service';
import * as constants from './reminders.constants';
import { REMINDER_MAX_ATTEMPTS } from './reminders.constants';

/**
 * sdd/session-reminders PR 2 (T6.11/T6.12): a diferencia de
 * reminders.service.spec.ts (Prisma mockeado), estos tests corren contra
 * Postgres real -- verifican dos invariantes que ningún mock puede probar:
 *   1. El WHERE de la query excluye deletedAt/correctedBy a nivel de motor
 *      SQL, no solo en el objeto que se le pasa a un mock (T6.11).
 *   2. La restricción @@unique real de la DB (no un mock de rechazo P2002)
 *      es lo que hace idempotente una segunda pasada del scan (T6.12).
 *
 * Requiere DATABASE_URL/DIRECT_URL apuntando a Postgres (docker-compose.yml
 * en la raíz del repo). Mismo patrón de fixtures que
 * notifications.e2e-spec.ts: usuario/paciente creados directo vía Prisma.
 */
describe('RemindersService (integration, real Prisma)', () => {
  let prisma: PrismaService;
  let service: RemindersService;
  const runId = Date.now();

  let therapistId: string;
  let patientId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    const passwordHash = await argon2.hash('TestPass123!');
    const therapist = await prisma.user.create({
      data: {
        email: `reminders-integration-${runId}@example.com`,
        passwordHash,
        name: 'Dra. Integración',
      },
    });
    therapistId = therapist.id;

    const patient = await prisma.patient.create({
      data: {
        fullName: 'Paciente Integración',
        rut: `${runId}-9`,
        birthDate: new Date('1990-01-01T12:00:00.000Z'),
        therapistId,
      },
    });
    patientId = patient.id;

    const notificationsService = new NotificationsService(prisma);
    // Stub del envío: sin RESEND_API_KEY el MailService real devuelve null y el
    // dispatch EMAIL queda FAILED (issue #286). Estos tests verifican la
    // idempotencia de la clave única, no el proveedor, así que no hay red.
    const mailService = {
      sendSessionReminderEmail: jest.fn().mockResolvedValue('resend-msg-id'),
    } as unknown as MailService;
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    service = new RemindersService(
      prisma,
      notificationsService,
      mailService,
      config,
    );
  }, 30000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.reminderDispatch.deleteMany({ where: { therapistId } });
    await prisma.notification.deleteMany({ where: { userId: therapistId } });
    await prisma.consultation.deleteMany({ where: { therapistId } });
    await prisma.patient.deleteMany({ where: { id: patientId } });
    await prisma.user.deleteMany({ where: { id: therapistId } });
    await prisma.onModuleDestroy();
  }, 30000);

  async function createConsultation(
    sessionDate: Date,
    overrides: { deletedAt?: Date; superseded?: boolean } = {},
  ) {
    const id = randomUUID();
    const consultation = await prisma.consultation.create({
      data: {
        id,
        groupId: id,
        patientId,
        therapistId,
        sessionDate,
        consultReason: 'Motivo de integración',
        intervention: 'Intervención de integración',
        scheduledAt: sessionDate,
        patientRut: `${runId}-9`,
        deletedAt: overrides.deletedAt ?? null,
      },
    });

    if (overrides.superseded) {
      // Simula una corrección: una segunda fila que apunta correctsId a la
      // primera, dejando la original con correctedBy != null -- exactamente
      // lo que el WHERE de scan() debe excluir (correctedBy: null).
      await prisma.consultation.create({
        data: {
          id: randomUUID(),
          groupId: id,
          patientId,
          therapistId,
          sessionDate,
          consultReason: 'Motivo corregido',
          intervention: 'Intervención de integración',
          scheduledAt: sessionDate,
          patientRut: `${runId}-9`,
          correctsId: id,
        },
      });
    }

    return consultation;
  }

  it('excluye consultas soft-deleted y versiones superadas del scan real (T6.11)', async () => {
    const dueSoon = new Date(Date.now() + 10 * 60 * 60 * 1000); // 10h -> H24 due

    const active = await createConsultation(dueSoon);
    const deleted = await createConsultation(dueSoon, {
      deletedAt: new Date(),
    });
    const superseded = await createConsultation(dueSoon, {
      superseded: true,
    });

    await service.scan();

    const activeDispatches = await prisma.reminderDispatch.findMany({
      where: { consultationId: active.id },
    });
    expect(activeDispatches.length).toBeGreaterThan(0);

    const deletedDispatches = await prisma.reminderDispatch.findMany({
      where: { consultationId: deleted.id },
    });
    expect(deletedDispatches).toHaveLength(0);

    // La fila ORIGINAL de la cadena superseded (correctedBy != null) nunca
    // debe recibir un dispatch propio -- solo la vigente (creada por
    // superseded:true, no capturada acá) podría, pero no es la que se
    // consulta en este assert.
    const supersededDispatches = await prisma.reminderDispatch.findMany({
      where: { consultationId: superseded.id },
    });
    expect(supersededDispatches).toHaveLength(0);
  }, 30000);

  it('dos scans consecutivos producen exactamente un dispatch por tupla (T6.12, idempotencia real)', async () => {
    const dueSoon = new Date(Date.now() + 10 * 60 * 60 * 1000); // 10h -> solo H24 due
    const consultation = await createConsultation(dueSoon);

    await service.scan();
    await service.scan();

    const dispatches = await prisma.reminderDispatch.findMany({
      where: { consultationId: consultation.id },
    });

    // Un único offset due (H24) x 2 canales (IN_APP, EMAIL) = 2 filas,
    // sin importar cuántas veces corra el scan -- la restricción @@unique
    // real de Postgres es la que garantiza esto, no un mock.
    expect(dispatches).toHaveLength(2);
    expect(dispatches.every((d) => d.status === 'SENT')).toBe(true);
  }, 30000);

  it('reintenta un EMAIL FAILED bajo el tope y deja de reintentar al agotarlo (#286)', async () => {
    const dueSoon = new Date(Date.now() + 10 * 60 * 60 * 1000);
    const retriable = await createConsultation(dueSoon);
    const exhausted = await createConsultation(dueSoon);

    const failedRow = (consultationId: string, attempts: number) => ({
      groupId: consultationId,
      sessionDate: dueSoon,
      offsetKind: 'H24' as const,
      channel: 'EMAIL' as const,
      consultationId,
      therapistId,
      status: 'FAILED' as const,
      error: 'proveedor caído',
      attempts,
      // Ya pasó el backoff: el último claim fue hace una hora.
      claimedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    await prisma.reminderDispatch.create({ data: failedRow(retriable.id, 1) });
    await prisma.reminderDispatch.create({
      data: failedRow(exhausted.id, REMINDER_MAX_ATTEMPTS),
    });

    await service.scan();

    const retried = await prisma.reminderDispatch.findFirstOrThrow({
      where: { consultationId: retriable.id, channel: 'EMAIL' },
    });
    expect(retried.status).toBe('SENT');
    expect(retried.attempts).toBe(2);
    expect(retried.resendMessageId).toBe('resend-msg-id');

    const notRetried = await prisma.reminderDispatch.findFirstOrThrow({
      where: { consultationId: exhausted.id, channel: 'EMAIL' },
    });
    expect(notRetried.status).toBe('FAILED');
    expect(notRetried.attempts).toBe(REMINDER_MAX_ATTEMPTS);
  }, 30000);

  it('no reintenta un EMAIL FAILED dentro del backoff (#286)', async () => {
    const dueSoon = new Date(Date.now() + 10 * 60 * 60 * 1000);
    const consultation = await createConsultation(dueSoon);
    await prisma.reminderDispatch.create({
      data: {
        groupId: consultation.id,
        sessionDate: dueSoon,
        offsetKind: 'H24',
        channel: 'EMAIL',
        consultationId: consultation.id,
        therapistId,
        status: 'FAILED',
        error: 'proveedor caído',
      },
    });

    await service.scan();

    const row = await prisma.reminderDispatch.findFirstOrThrow({
      where: { consultationId: consultation.id, channel: 'EMAIL' },
    });
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(1);
  }, 30000);

  // issue #286 (parte 2): el filtro "accionable" solo se puede validar contra
  // SQL real. Los asserts se acotan a las consultas de este test porque la DB
  // local puede tener otras filas dentro de la ventana de 24h.
  describe('scan solo toma consultas accionables (#286 parte 2)', () => {
    const HOUR_MS = 60 * 60 * 1000;

    function claimRows(
      consultation: { id: string; sessionDate: Date },
      offsetKind: 'H24' | 'H2',
      status: 'SENT' | 'SKIPPED' | 'FAILED',
    ) {
      return (['IN_APP', 'EMAIL'] as const).map((channel) =>
        prisma.reminderDispatch.create({
          data: {
            groupId: consultation.id,
            sessionDate: consultation.sessionDate,
            offsetKind,
            channel,
            consultationId: consultation.id,
            therapistId,
            status,
            // FAILED recién reclamado: queda dentro del backoff, no reintenta.
          },
        }),
      );
    }

    function createCallsFor(spy: jest.SpyInstance, consultationId: string) {
      return (
        spy.mock.calls as { data: { consultationId: string } }[][]
      ).filter((call) => call[0].data.consultationId === consultationId);
    }

    it('un scan no reintenta insertar (sin P2002) consultas ya reclamadas y sí alcanza a la nueva aunque la preceda un lote lleno', async () => {
      // Lote diminuto: antes de este fix, las 3 ya reclamadas (más próximas)
      // llenaban el lote de 2 y la nueva, más lejana, nunca se alcanzaba.
      jest.replaceProperty(constants, 'SCAN_BATCH_LIMIT', 2);

      const claimed = [
        await createConsultation(new Date(Date.now() + 5 * HOUR_MS)),
        await createConsultation(new Date(Date.now() + 6 * HOUR_MS)),
        await createConsultation(new Date(Date.now() + 7 * HOUR_MS)),
      ];
      for (const consultation of claimed) {
        await Promise.all(claimRows(consultation, 'H24', 'SENT'));
      }
      const fresh = await createConsultation(
        new Date(Date.now() + 20 * HOUR_MS),
      );

      const createSpy = jest.spyOn(prisma.reminderDispatch, 'create');
      await service.scan();

      for (const consultation of claimed) {
        expect(createCallsFor(createSpy, consultation.id)).toHaveLength(0);
      }
      const freshRows = await prisma.reminderDispatch.findMany({
        where: { consultationId: fresh.id },
      });
      expect(freshRows).toHaveLength(2);
      expect(freshRows.every((r) => r.offsetKind === 'H24')).toBe(true);
    }, 30000);

    it('con la sesión a <2h: H24 SKIPPED sin H2 sigue accionable; con H2 reclamado en ambos canales ya no', async () => {
      const needsH2 = await createConsultation(
        new Date(Date.now() + 1 * HOUR_MS),
      );
      await Promise.all(claimRows(needsH2, 'H24', 'SKIPPED'));
      const doneH2 = await createConsultation(
        new Date(Date.now() + 1 * HOUR_MS),
      );
      await Promise.all(claimRows(doneH2, 'H24', 'SKIPPED'));
      await Promise.all(claimRows(doneH2, 'H2', 'FAILED'));

      const createSpy = jest.spyOn(prisma.reminderDispatch, 'create');
      await service.scan();

      const h2Rows = await prisma.reminderDispatch.findMany({
        where: { consultationId: needsH2.id, offsetKind: 'H2' },
      });
      expect(h2Rows).toHaveLength(2);
      expect(h2Rows.every((r) => r.status === 'SENT')).toBe(true);
      // doneH2 tiene todo reclamado (FAILED cuenta como reclamado: lo
      // recupera retryStaleDispatches, no el scan).
      expect(createCallsFor(createSpy, doneH2.id)).toHaveLength(0);
    }, 30000);

    it('una consulta con un solo canal reclamado sigue accionable (completa el canal faltante)', async () => {
      const consultation = await createConsultation(
        new Date(Date.now() + 10 * HOUR_MS),
      );
      await prisma.reminderDispatch.create({
        data: {
          groupId: consultation.id,
          sessionDate: consultation.sessionDate,
          offsetKind: 'H24',
          channel: 'IN_APP',
          consultationId: consultation.id,
          therapistId,
          status: 'SENT',
        },
      });

      await service.scan();

      const emailRow = await prisma.reminderDispatch.findFirst({
        where: { consultationId: consultation.id, channel: 'EMAIL' },
      });
      expect(emailRow?.status).toBe('SENT');
    }, 30000);
  });
});
