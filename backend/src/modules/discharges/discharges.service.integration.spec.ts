import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PatientsService } from '../patients/patients.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GoogleTokenCryptoService } from '../calendar-integration/google-token-crypto.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import { GoogleCalendarClient } from '../calendar-integration/google-calendar.client';
import { ConsultationsService } from '../consultations/consultations.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentGatewayRegistry } from '../payments/payment-gateway.registry';
import { PaymentAccountService } from '../payments/payment-account.service';
import { PaymentCredentialCryptoService } from '../payments/payment-credential-crypto.service';
import { MailService } from '../mail/mail.service';
import { AvailabilityService } from '../availability/availability.service';
import { DocumentsService } from '../documents/documents.service';
import { DischargesService } from './discharges.service';

// Fecha futura determinista: `daysAhead` días después de hoy (UTC) a `hourUtc`.
function futureUtcDay(daysAhead: number, hourUtc: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + daysAhead,
      hourUtc,
    ),
  );
}

/**
 * T2b: cierre de tratamiento (DischargesService.issue) frente a una reserva
 * pública concurrente sobre el mismo paciente. Postgres real, mismo arranque
 * que consultations.service.integration.spec.ts (softDelete concurrente).
 *
 * Determinismo: en vez de apostar a que Promise.allSettled intercale bien, un
 * "holder" retiene Patient FOR UPDATE; se encolan las dos operaciones en el
 * orden deseado (se espera en pg_stat_activity a que ambas estén bloqueadas) y
 * recién entonces se suelta el holder. Así el orden de adquisición del lock es
 * el de la cola de Postgres y no depende del planificador.
 */
describe('DischargesService.issue (integration, cierre concurrente con reserva pública)', () => {
  let prisma: PrismaService;
  let consultationsService: ConsultationsService;
  let dischargesService: DischargesService;
  const runId = Date.now();
  const extraPatientIds: string[] = [];
  let therapistId: string;

  // Solo "false" explícito apaga Google: no se necesita cliente real aquí.
  const config = {
    get: (key: string) =>
      key === 'GOOGLE_CALENDAR_SYNC_ENABLED'
        ? 'false'
        : key === 'PAYMENTS_ENABLED'
          ? 'false'
          : undefined,
  } as unknown as ConfigService;

  function buildPaymentsService(): PaymentsService {
    const registry = new PaymentGatewayRegistry([]);
    const accounts = new PaymentAccountService(
      prisma,
      registry,
      new PaymentCredentialCryptoService(config),
      new AuditService(prisma),
    );
    return new PaymentsService(
      prisma,
      accounts,
      registry,
      config,
      new MailService(config),
      new NotificationsService(prisma),
    );
  }

  async function createConsentedPatient(label: string) {
    const patient = await prisma.patient.create({
      data: {
        fullName: `Paciente ${label}`,
        rut: `${runId}-${extraPatientIds.length + 1}`,
        birthDate: new Date('1990-01-01T12:00:00.000Z'),
        therapistId,
      },
    });
    extraPatientIds.push(patient.id);
    await prisma.patientConsent.create({
      data: {
        patientId: patient.id,
        purpose: 'TREATMENT',
        action: 'GRANT',
        recordedById: therapistId,
        evidence: 'Consentimiento otorgado en fixture de test (integration)',
      },
    });
    return patient;
  }

  async function createClosablePatient(label: string) {
    const patient = await createConsentedPatient(label);
    const draft = await dischargesService.createDraft(
      patient.id,
      { closureReason: 'DISCHARGED' } as never,
      therapistId,
    );
    await prisma.treatmentDischarge.update({
      where: { id: draft.id },
      data: {
        consultReason: 'Motivo de consulta',
        evolutionSummary: 'Evolución favorable',
        statusAtDischarge: 'Estable',
        recommendations: 'Control a los tres meses',
      },
    });
    return { patient, dischargeId: draft.id };
  }

  // Espera a que haya al menos `count` sesiones bloqueadas esperando un lock de
  // fila de Patient o de User (las operaciones encoladas detrás del holder).
  async function waitForBlockedPatientLocks(count: number): Promise<void> {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND (query ILIKE '%"Patient"%' OR query ILIKE '%"User"%')
          AND query ILIKE '%FOR %'`;
      if ((rows[0]?.n ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Las operaciones no quedaron bloqueadas a tiempo');
  }

  // Retiene el lock de la fila User del terapeuta (el de lockTherapistSchedule)
  // hasta que se llame a `release`.
  async function holdTherapistLock(): Promise<{
    release: () => void;
    done: Promise<void>;
  }> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${therapistId} FOR UPDATE`;
        markLocked();
        await gate;
      },
      { timeout: 30000, maxWait: 10000 },
    );
    await locked;
    return { release, done };
  }

  // Espera a que las operaciones queden encoladas; si no llegan, suelta el
  // holder antes de fallar para no dejar la transacción abierta.
  async function awaitQueued(
    holder: { release: () => void; done: Promise<void> },
    count: number,
  ): Promise<void> {
    try {
      await waitForBlockedPatientLocks(count);
    } catch (err) {
      holder.release();
      await holder.done;
      throw err;
    }
  }

  // Retiene Patient FOR UPDATE hasta que se llame a `release`.
  async function holdPatientLock(patientId: string): Promise<{
    locked: Promise<void>;
    release: () => void;
    done: Promise<void>;
  }> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Patient" WHERE id = ${patientId} FOR UPDATE`;
        markLocked();
        await gate;
      },
      { timeout: 30000, maxWait: 10000 },
    );
    await locked;
    return { locked, release, done };
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    const passwordHash = await argon2.hash('TestPass123!');
    const therapist = await prisma.user.create({
      data: {
        email: `discharges-concurrency-${runId}@example.com`,
        passwordHash,
        name: 'Dra. Cierre Concurrente',
        rut: '12345678-5',
      },
    });
    therapistId = therapist.id;

    const auditService = new AuditService(prisma);
    const availability = new AvailabilityService(prisma, {
      get: () => undefined,
    } as unknown as ConfigService);
    const calendarSync = new CalendarSyncService(
      prisma,
      {} as unknown as GoogleTokenCryptoService,
      {} as unknown as GoogleCalendarClient,
      new NotificationsService(prisma),
      config,
      auditService,
    );
    const patientsService = new PatientsService(
      prisma,
      auditService,
      calendarSync,
      buildPaymentsService(),
      availability,
    );
    consultationsService = new ConsultationsService(
      prisma,
      patientsService,
      calendarSync,
      buildPaymentsService(),
      availability,
    );
    dischargesService = new DischargesService(
      prisma,
      patientsService,
      auditService,
      availability,
      buildPaymentsService(),
      calendarSync,
      // T3: el PDF no se ejercita aquí (carreras de cierre sobre base real).
      {} as unknown as DocumentsService,
    );
    jest
      .spyOn(dischargesService, 'ensurePdf')
      .mockResolvedValue({ documentId: null, pdfSha256: null } as never);
  }, 30000);

  afterAll(async () => {
    await prisma.bookedSlot.deleteMany({ where: { therapistId } });
    await prisma.consultationHistory.deleteMany({
      where: { editedById: therapistId },
    });
    await prisma.consultation.deleteMany({ where: { therapistId } });
    await prisma.treatmentDischarge.deleteMany({ where: { therapistId } });
    await prisma.patientConsent.deleteMany({
      where: { patientId: { in: extraPatientIds } },
    });
    await prisma.patient.deleteMany({ where: { id: { in: extraPatientIds } } });
    // AuditLog es append-only (trigger) y su FK al User es Restrict: el usuario
    // se da de baja en vez de borrarse, igual que en discharges.e2e-spec.ts.
    await prisma.user.updateMany({
      where: { id: therapistId },
      data: { deletedAt: new Date() },
    });
    await prisma.onModuleDestroy();
  }, 30000);

  // Reserva que gana la cola: confirma antes que el cierre. El cierre debe ver
  // su consulta bajo el lock y cancelarla junto con su BookedSlot.
  it('una reserva pública que gana el lock antes del cierre queda cancelada y sin BookedSlot huérfano', async () => {
    const { patient, dischargeId } =
      await createClosablePatient('Reserva Primero');
    const slotStart = futureUtcDay(50, 13);

    const holder = await holdPatientLock(patient.id);
    const booking = consultationsService.createFromPublicBooking(
      therapistId,
      patient.id,
      patient.rut,
      slotStart,
      50,
    );
    const booked = booking.then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    );
    await waitForBlockedPatientLocks(1);
    const closing = dischargesService.issue(dischargeId, therapistId);
    const closed = closing.then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    );
    await waitForBlockedPatientLocks(2);
    holder.release();
    await holder.done;

    const [bookingResult, closingResult] = await Promise.all([booked, closed]);
    expect(closingResult.ok).toBe(true);
    expect(bookingResult.ok).toBe(true);

    // Ninguna ocupación de horario sobrevive al cierre.
    await expect(
      prisma.bookedSlot.findMany({ where: { therapistId, slotStart } }),
    ).resolves.toHaveLength(0);
    const consultations = await prisma.consultation.findMany({
      where: { patientId: patient.id },
    });
    expect(consultations).toHaveLength(1);
    expect(consultations[0].cancelledByDischargeId).toBe(dischargeId);
    expect(consultations[0].deletedAt).not.toBeNull();
    if (closingResult.ok) {
      expect(closingResult.value.cancelledConsultations).toBe(1);
    }
  }, 30000);

  // Cierre que gana la cola: la reserva que esperaba detrás ya NO puede dejar
  // una consulta viva ni un BookedSlot en un paciente cerrado.
  // Requiere que el FOR SHARE de ConsultationsService.createFromPublicBooking
  // también filtre "treatmentStatus" = 'ACTIVE': la comprobación de T1 en
  // PatientsService.resolveForPublicBooking es una lectura sin lock, previa al
  // FOR SHARE, y no cubre este intercalado.
  it('una reserva pública que espera detrás del cierre no deja BookedSlot ni consulta vigente en un paciente cerrado', async () => {
    const { patient, dischargeId } =
      await createClosablePatient('Cierre Primero');
    const slotStart = futureUtcDay(51, 13);

    const holder = await holdPatientLock(patient.id);
    const closing = dischargesService.issue(dischargeId, therapistId);
    const closed = closing.then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    );
    await waitForBlockedPatientLocks(1);
    const booking = consultationsService.createFromPublicBooking(
      therapistId,
      patient.id,
      patient.rut,
      slotStart,
      50,
    );
    const booked = booking.then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    );
    await waitForBlockedPatientLocks(2);
    holder.release();
    await holder.done;

    const [closingResult] = await Promise.all([closed, booked]);
    expect(closingResult.ok).toBe(true);

    const status = await prisma.patient.findUniqueOrThrow({
      where: { id: patient.id },
      select: { treatmentStatus: true },
    });
    expect(status.treatmentStatus).toBe('DISCHARGED');

    // Invariante de cierre: sin BookedSlot en el horario y sin consulta futura
    // vigente (sin deletedAt) para el paciente cerrado.
    await expect(
      prisma.bookedSlot.findMany({ where: { therapistId, slotStart } }),
    ).resolves.toHaveLength(0);
    await expect(
      prisma.consultation.findMany({
        where: {
          patientId: patient.id,
          deletedAt: null,
          sessionDate: { gt: new Date() },
        },
      }),
    ).resolves.toHaveLength(0);
  }, 30000);

  // Dos cierres del mismo paciente (borradores distintos no existen: el segundo
  // issue del mismo informe pierde con 409) no dejan estado a medias.
  it('dos emisiones simultáneas del mismo informe: una gana y la otra recibe 409, sin duplicar la cancelación', async () => {
    const { patient, dischargeId } =
      await createClosablePatient('Doble Cierre');
    const slotStart = futureUtcDay(52, 13);
    await consultationsService.createFromPublicBooking(
      therapistId,
      patient.id,
      patient.rut,
      slotStart,
      50,
    );

    const results = await Promise.allSettled([
      dischargesService.issue(dischargeId, therapistId),
      dischargesService.issue(dischargeId, therapistId),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await expect(
      prisma.bookedSlot.findMany({ where: { therapistId, slotStart } }),
    ).resolves.toHaveLength(0);
    const cancelled = await prisma.consultation.findMany({
      where: { patientId: patient.id, cancelledByDischargeId: dischargeId },
    });
    expect(cancelled).toHaveLength(1);
  }, 30000);

  // Defecto 1: el cierre debe tomar el lock del terapeuta. Una reprogramación
  // (correct con cambio de fecha) que gana la cola crea una versión nueva de la
  // consulta; el cierre, que espera detrás, tiene que ver esa versión y no la
  // superada, y no dejar ninguna consulta futura viva.
  it('una reprogramación que gana el lock del terapeuta antes del cierre no deja ninguna versión futura viva', async () => {
    const { patient, dischargeId } =
      await createClosablePatient('Reprogramacion');
    const slotStart = futureUtcDay(53, 13);
    await consultationsService.createFromPublicBooking(
      therapistId,
      patient.id,
      patient.rut,
      slotStart,
      50,
    );
    const original = await prisma.consultation.findFirstOrThrow({
      where: { patientId: patient.id },
    });

    const holder = await holdTherapistLock();
    const rescheduling = consultationsService
      .correct(
        original.id,
        { sessionDate: futureUtcDay(54, 13).toISOString() } as never,
        therapistId,
      )
      .then(
        (value) => ({ ok: true as const, value }),
        (reason: unknown) => ({ ok: false as const, reason }),
      );
    await awaitQueued(holder, 1);
    const closed = dischargesService.issue(dischargeId, therapistId).then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    );
    // Con el lock del terapeuta el cierre queda encolado detrás de la
    // reprogramación; sin él no se bloquearía y esta espera agotaría el plazo.
    await awaitQueued(holder, 2);
    holder.release();
    await holder.done;

    const [reschedulingResult, closingResult] = await Promise.all([
      rescheduling,
      closed,
    ]);
    expect(reschedulingResult.ok).toBe(true);
    expect(closingResult.ok).toBe(true);

    // Ninguna versión vigente (no superada) y futura sobrevive al cierre.
    await expect(
      prisma.consultation.findMany({
        where: {
          patientId: patient.id,
          correctedBy: null,
          deletedAt: null,
          sessionDate: { gt: new Date() },
        },
      }),
    ).resolves.toHaveLength(0);
    await expect(
      prisma.bookedSlot.findMany({
        where: { therapistId, groupId: original.groupId },
      }),
    ).resolves.toHaveLength(0);
    if (closingResult.ok) {
      expect(closingResult.value.cancelledConsultations).toBe(1);
    }
  }, 30000);

  // Defecto 2B: createDraft debe ser atómico. Ambos POST se encolan detrás del
  // lock del terapeuta (determinista) y el segundo ve el borrador del primero.
  it('dos createDraft concurrentes del mismo paciente: uno crea el borrador y el otro recibe 409', async () => {
    const patient = await createConsentedPatient('Doble Borrador');

    const holder = await holdTherapistLock();
    const attempts = [1, 2].map(() =>
      dischargesService
        .createDraft(
          patient.id,
          { closureReason: 'DISCHARGED' } as never,
          therapistId,
        )
        .then(
          (value) => ({ ok: true as const, value }),
          (reason: unknown) => ({ ok: false as const, reason }),
        ),
    );
    await awaitQueued(holder, 2);
    holder.release();
    await holder.done;

    const results = await Promise.all(attempts);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok && failed.reason).toBeInstanceOf(
      ConflictException,
    );
    await expect(
      prisma.treatmentDischarge.count({
        where: { patientId: patient.id, status: 'DRAFT' },
      }),
    ).resolves.toBe(1);
  }, 30000);
});
