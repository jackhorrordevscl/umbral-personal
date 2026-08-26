import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { RemindersService } from './reminders.service';

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
    // Sin RESEND_API_KEY -- el canal EMAIL se saltea con un log (no hay
    // llamada de red real en estos tests de integración de Prisma).
    const mailService = new MailService({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);
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
});
