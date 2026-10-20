import { buildTestClinicalCrypto } from '../../common/crypto/clinical-text-crypto.testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
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
import { DischargeCancellationNotifier } from './discharge-cancellation-notifier.service';
import {
  computeDischargeHash,
  dischargeHashInputFromRow,
} from './util/discharge-hash.util';

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
      buildTestClinicalCrypto(),
    );
    consultationsService = new ConsultationsService(
      prisma,
      patientsService,
      calendarSync,
      buildPaymentsService(),
      availability,
      auditService,
      buildTestClinicalCrypto(),
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
      // T4b: el aviso por email no se ejercita en las carreras de cierre.
      { notify: jest.fn() } as unknown as DischargeCancellationNotifier,

      buildTestClinicalCrypto(),
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

  // ---- Issue #446: locks de create() y correct() frente al cierre ----
  // Determinismo igual que arriba: un holder retiene Patient FOR UPDATE, las
  // operaciones se encolan en el orden deseado y solo entonces se suelta.
  // Si se quita el lock de la operación bajo prueba, no queda bloqueada y
  // awaitQueued agota el plazo: la prueba falla en vez de pasar por azar.

  type Settled<T> = { ok: true; value: T } | { ok: false; reason: unknown };
  const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
    promise.then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    );

  function newConsultationDto(patientId: string, extra: object = {}) {
    return {
      patientId,
      sessionDate: futureUtcDay(60, 14).toISOString(),
      consultReason: 'Motivo',
      intervention: 'Intervención',
      ...extra,
    } as never;
  }

  // Simula a quien cierra la fila sin pasar por el lock del terapeuta (otra
  // ruta que solo toma Patient): retiene Patient FOR UPDATE con el estado ya en
  // DISCHARGED hasta `release`. La operación bajo prueba debe esperarlo en su
  // propio lock de fila y, al despertar, ver el estado cerrado.
  async function holdClosedPatientRow(patientId: string): Promise<{
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
        await tx.patient.update({
          where: { id: patientId },
          data: { treatmentStatus: 'DISCHARGED' },
        });
        markLocked();
        await gate;
      },
      { timeout: 30000, maxWait: 10000 },
    );
    await locked;
    return { release, done };
  }

  it('create() que espera detrás de un cierre recibe 409 y no deja consulta en el paciente cerrado', async () => {
    const { patient, dischargeId } =
      await createClosablePatient('Create Tras Cierre');

    const holder = await holdPatientLock(patient.id);
    const closed = settle(dischargesService.issue(dischargeId, therapistId));
    await awaitQueued(holder, 1);
    const created = settle(
      consultationsService.create(newConsultationDto(patient.id), therapistId),
    );
    await awaitQueued(holder, 2);
    holder.release();
    await holder.done;

    const [closingResult, creationResult] = await Promise.all([
      closed,
      created,
    ]);
    expect(closingResult.ok).toBe(true);
    expect(creationResult.ok).toBe(false);
    if (!creationResult.ok) {
      expect(creationResult.reason).toBeInstanceOf(ConflictException);
      expect(
        (creationResult.reason as ConflictException).getResponse(),
      ).toMatchObject({ code: 'PATIENT_TREATMENT_CLOSED' });
    }
    await expect(
      prisma.patient.findUniqueOrThrow({
        where: { id: patient.id },
        select: { treatmentStatus: true },
      }),
    ).resolves.toEqual({ treatmentStatus: 'DISCHARGED' });
    await expect(
      prisma.consultation.count({
        where: { patientId: patient.id, deletedAt: null },
      }),
    ).resolves.toBe(0);
  }, 30000);

  it('create() con reopenPatient detrás de un cierre reabre al paciente y deja TREATMENT_REOPENED con el estado previo', async () => {
    const { patient, dischargeId } = await createClosablePatient(
      'Reapertura Auditada',
    );

    const holder = await holdPatientLock(patient.id);
    const closed = settle(dischargesService.issue(dischargeId, therapistId));
    await awaitQueued(holder, 1);
    const created = settle(
      consultationsService.create(
        newConsultationDto(patient.id, { reopenPatient: true }),
        therapistId,
        { ipAddress: '10.0.0.7', userAgent: 'jest-integration' },
      ),
    );
    await awaitQueued(holder, 2);
    holder.release();
    await holder.done;

    const [closingResult, creationResult] = await Promise.all([
      closed,
      created,
    ]);
    expect(closingResult.ok).toBe(true);
    expect(creationResult.ok).toBe(true);
    await expect(
      prisma.patient.findUniqueOrThrow({
        where: { id: patient.id },
        select: { treatmentStatus: true },
      }),
    ).resolves.toEqual({ treatmentStatus: 'ACTIVE' });

    const rows = await prisma.auditLog.findMany({
      where: { action: 'TREATMENT_REOPENED', resourceId: patient.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: therapistId,
      resource: 'Patient',
      ipAddress: '10.0.0.7',
      userAgent: 'jest-integration',
    });
    if (creationResult.ok) {
      expect(rows[0].detail).toBe(
        `previousStatus=DISCHARGED consultationId=${(creationResult.value as { id: string }).id}`,
      );
    }
  }, 30000);

  it('create() toma Patient FOR UPDATE: espera a quien ya cerró la fila y ve el estado cerrado', async () => {
    const patient = await createConsentedPatient('Create Lock Fila');

    const holder = await holdClosedPatientRow(patient.id);

    const created = settle(
      consultationsService.create(newConsultationDto(patient.id), therapistId),
    );
    await awaitQueued(holder, 1);
    holder.release();
    await holder.done;

    const creationResult = await created;
    expect(creationResult.ok).toBe(false);
    if (!creationResult.ok) {
      expect(creationResult.reason).toBeInstanceOf(ConflictException);
    }
    await expect(
      prisma.consultation.count({ where: { patientId: patient.id } }),
    ).resolves.toBe(0);
  }, 30000);

  async function createFutureConsultation(
    patient: { id: string; rut: string },
    daysAhead: number,
  ) {
    await consultationsService.createFromPublicBooking(
      therapistId,
      patient.id,
      patient.rut,
      futureUtcDay(daysAhead, 13),
      50,
    );
    return prisma.consultation.findFirstOrThrow({
      where: { patientId: patient.id },
    });
  }

  async function expectNoLiveFutureState(
    patientId: string,
    groupId: string,
  ): Promise<void> {
    await expect(
      prisma.consultation.findMany({
        where: {
          patientId,
          correctedBy: null,
          deletedAt: null,
          sessionDate: { gt: new Date() },
        },
      }),
    ).resolves.toHaveLength(0);
    await expect(
      prisma.bookedSlot.count({ where: { therapistId, groupId } }),
    ).resolves.toBe(0);
  }

  it('correct() toma Patient FOR SHARE: espera a quien cerró la fila y no corrige sesiones futuras', async () => {
    const patient = await createConsentedPatient('Correct Lock Fila');
    const original = await createFutureConsultation(patient, 61);

    const holder = await holdClosedPatientRow(patient.id);
    const corrected = settle(
      consultationsService.correct(
        original.id,
        { intervention: 'Intervención corregida' } as never,
        therapistId,
      ),
    );
    await awaitQueued(holder, 1);
    holder.release();
    await holder.done;

    const correctionResult = await corrected;
    expect(correctionResult.ok).toBe(false);
    if (!correctionResult.ok) {
      expect(correctionResult.reason).toBeInstanceOf(ConflictException);
      expect(
        (correctionResult.reason as ConflictException).getResponse(),
      ).toMatchObject({ code: 'PATIENT_TREATMENT_CLOSED' });
    }
    await expect(
      prisma.consultation.count({ where: { correctsId: original.id } }),
    ).resolves.toBe(0);
  }, 30000);

  it('correct() que espera detrás de un cierre no resucita la consulta cancelada', async () => {
    const { patient, dischargeId } = await createClosablePatient(
      'Correct Tras Cierre',
    );
    const original = await createFutureConsultation(patient, 62);

    const holder = await holdPatientLock(patient.id);
    const closed = settle(dischargesService.issue(dischargeId, therapistId));
    await awaitQueued(holder, 1);
    // Sin cambio de fecha: igual toma el lock del terapeuta (issue #446).
    const corrected = settle(
      consultationsService.correct(
        original.id,
        { intervention: 'Intervención corregida' } as never,
        therapistId,
      ),
    );
    await awaitQueued(holder, 2);
    holder.release();
    await holder.done;

    const [closingResult, correctionResult] = await Promise.all([
      closed,
      corrected,
    ]);
    expect(closingResult.ok).toBe(true);
    expect(correctionResult.ok).toBe(false);
    if (!correctionResult.ok) {
      expect(correctionResult.reason).toBeInstanceOf(NotFoundException);
    }
    await expectNoLiveFutureState(patient.id, original.groupId);
  }, 30000);

  it('correct() que gana la cola antes del cierre no deja ninguna versión futura viva', async () => {
    const { patient, dischargeId } = await createClosablePatient(
      'Correct Antes Cierre',
    );
    const original = await createFutureConsultation(patient, 63);

    const holder = await holdPatientLock(patient.id);
    const corrected = settle(
      consultationsService.correct(
        original.id,
        { intervention: 'Intervención corregida' } as never,
        therapistId,
      ),
    );
    await awaitQueued(holder, 1);
    const closed = settle(dischargesService.issue(dischargeId, therapistId));
    await awaitQueued(holder, 2);
    holder.release();
    await holder.done;

    const [closingResult, correctionResult] = await Promise.all([
      closed,
      corrected,
    ]);
    expect(correctionResult.ok).toBe(true);
    expect(closingResult.ok).toBe(true);
    if (closingResult.ok) {
      expect(closingResult.value.cancelledConsultations).toBe(1);
    }
    await expectNoLiveFutureState(patient.id, original.groupId);
  }, 30000);

  // ADR 0004 (opción B): los textos libres del informe se guardan cifrados; el
  // hash de contenido y la verificación trabajan sobre el texto en claro.
  it('guarda cifrados los textos del informe, emite y verifica sobre texto plano y re-cifra la corrección', async () => {
    const patient = await createConsentedPatient('Cifrado Alta');
    const texts = {
      consultReason: 'Motivo reservado',
      diagnosis: 'Diagnóstico reservado',
      evolutionSummary: 'Evolución reservada',
      statusAtDischarge: 'Estado reservado',
      recommendations: 'Recomendaciones reservadas',
    };
    const expectEncrypted = async (id: string) => {
      const raw = await prisma.treatmentDischarge.findUniqueOrThrow({
        where: { id },
      });
      for (const field of Object.keys(texts) as (keyof typeof texts)[]) {
        expect(raw[field]).toMatch(/^enc:v3:/);
      }
      expect(JSON.stringify(raw)).not.toContain('reservad');
    };

    const draft = await dischargesService.createDraft(
      patient.id,
      { closureReason: 'DISCHARGED' } as never,
      therapistId,
    );
    const updated = await dischargesService.update(
      draft.id,
      texts as never,
      therapistId,
    );
    expect(updated).toMatchObject(texts);
    await expectEncrypted(draft.id);

    const issued = await dischargesService.issue(draft.id, therapistId);
    expect(issued).toMatchObject(texts);
    expect(issued.contentHash).toBe(
      computeDischargeHash(dischargeHashInputFromRow(issued)),
    );
    await expectEncrypted(draft.id);
    const verification = await dischargesService.verify(draft.id, therapistId);
    expect(verification.valid).toBe(true);

    const corrected = await dischargesService.correct(draft.id, therapistId);
    expect(corrected).toMatchObject(texts);
    await expectEncrypted(corrected.id);
    const listed = await dischargesService.findByPatient(
      patient.id,
      therapistId,
    );
    expect(listed.map((d) => d.consultReason)).toEqual([
      texts.consultReason,
      texts.consultReason,
    ]);
  }, 30000);

  // Un texto cifrado alterado en la base no tumba el listado ni verify().
  it('un texto cifrado alterado deja el listado legible y verify() en valid=false', async () => {
    const patient = await createConsentedPatient('Texto Ilegible');
    const draft = await dischargesService.createDraft(
      patient.id,
      { closureReason: 'DISCHARGED' } as never,
      therapistId,
    );
    await dischargesService.update(
      draft.id,
      {
        consultReason: 'Motivo reservado',
        diagnosis: 'Diagnóstico reservado',
        evolutionSummary: 'Evolución reservada',
        statusAtDischarge: 'Estado reservado',
        recommendations: 'Recomendaciones reservadas',
      } as never,
      therapistId,
    );
    await dischargesService.issue(draft.id, therapistId);
    const stored = await prisma.treatmentDischarge.findUniqueOrThrow({
      where: { id: draft.id },
      select: { diagnosis: true },
    });
    await prisma.treatmentDischarge.update({
      where: { id: draft.id },
      data: { diagnosis: `${stored.diagnosis!.slice(0, -4)}AAAA` },
    });

    const listed = await dischargesService.findByPatient(
      patient.id,
      therapistId,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      diagnosis: null,
      consultReason: 'Motivo reservado',
      unreadableFields: ['diagnosis'],
    });
    await expect(
      dischargesService.verify(draft.id, therapistId),
    ).resolves.toMatchObject({ valid: false, dischargeId: draft.id });
    await expect(
      dischargesService.findOne(draft.id, therapistId),
    ).rejects.toThrow();
  }, 30000);

  // Cerrar (A), reabrir con una consulta nueva y cerrar otra vez (B): emitir la
  // corrección de A no debe pisar el estado que fijó B ni auditar un cierre.
  it('emitir la corrección de un episodio anterior no pisa el estado del cierre posterior', async () => {
    const { patient, dischargeId: dischargeA } =
      await createClosablePatient('Episodio Previo');
    await dischargesService.issue(dischargeA, therapistId);
    const correctionA = await dischargesService.correct(
      dischargeA,
      therapistId,
    );

    await consultationsService.create(
      newConsultationDto(patient.id, { reopenPatient: true }),
      therapistId,
    );
    const draftB = await dischargesService.createDraft(
      patient.id,
      { closureReason: 'REFERRED', referralDestination: 'Hospital' } as never,
      therapistId,
    );
    await dischargesService.update(
      draftB.id,
      {
        consultReason: 'Motivo B',
        evolutionSummary: 'Evolución B',
        statusAtDischarge: 'Estable',
        recommendations: 'Control',
      } as never,
      therapistId,
    );
    await dischargesService.issue(draftB.id, therapistId);
    await expect(
      prisma.patient.findUniqueOrThrow({
        where: { id: patient.id },
        select: { treatmentStatus: true },
      }),
    ).resolves.toEqual({ treatmentStatus: 'REFERRED' });

    await dischargesService.issue(correctionA.id, therapistId);

    await expect(
      prisma.patient.findUniqueOrThrow({
        where: { id: patient.id },
        select: { treatmentStatus: true },
      }),
    ).resolves.toEqual({ treatmentStatus: 'REFERRED' });
    const closures = await prisma.auditLog.findMany({
      where: { action: 'TREATMENT_CLOSED', resourceId: patient.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(closures.map((row) => row.detail)).toEqual([
      expect.stringContaining(`dischargeId=${dischargeA}`),
      expect.stringContaining(`dischargeId=${draftB.id}`),
    ]);
  }, 30000);

  // issue() leía el borrador sin bloquear su fila: una edición que se confirma
  // entre esa lectura y su UPDATE condicional (que solo exige status = DRAFT)
  // dejaba el informe ISSUED con el texto nuevo y el hash del viejo. Un "holder"
  // retiene la fila, issue() queda encolado, el holder edita y confirma: el
  // hash emitido debe corresponder al texto editado.
  it('una edición que se confirma mientras issue() espera no deja un hash que no corresponde al texto emitido', async () => {
    const { dischargeId } = await createClosablePatient('Edición En Emisión');
    const editedText = 'Motivo editado durante la emisión';

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "TreatmentDischarge" WHERE id = ${dischargeId} FOR UPDATE`;
        markLocked();
        await gate;
        await tx.treatmentDischarge.update({
          where: { id: dischargeId },
          data: { consultReason: editedText },
        });
      },
      { timeout: 30000, maxWait: 10000 },
    );
    await locked;

    const issuing = dischargesService.issue(dischargeId, therapistId);
    const issued = issuing.then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    );

    // issue() queda esperando el lock de la fila retenida por el holder.
    const deadline = Date.now() + 10000;
    for (;;) {
      const rows = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if ((rows[0]?.n ?? 0) >= 1) break;
      if (Date.now() > deadline) {
        release();
        await holder;
        throw new Error('issue() no quedó esperando el lock a tiempo');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    release();
    await holder;

    const result = await issued;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.consultReason).toBe(editedText);
      expect(result.value.contentHash).toBe(
        computeDischargeHash(dischargeHashInputFromRow(result.value)),
      );
    }
    const verification = await dischargesService.verify(
      dischargeId,
      therapistId,
    );
    expect(verification.valid).toBe(true);
  }, 30000);
});
