import { NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { buildTestClinicalCrypto } from '../../common/crypto/clinical-text-crypto.testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import { PaymentsService } from '../payments/payments.service';
import { AvailabilityService } from '../availability/availability.service';
import { PatientsService } from './patients.service';

// issue #488: PatientsService.update leía fuera de la transacción y sin lock.
// Estas pruebas corren contra Postgres real porque lo que verifican es el
// comportamiento del lock, que un mock no puede reproducir.
describe('PatientsService.update (integration, concurrencia real)', () => {
  let prisma: PrismaService;
  let service: PatientsService;
  let therapistId: string;
  const patientIds: string[] = [];
  const runId = Date.now() + 7;

  async function createPatient(suffix: string) {
    const patient = await prisma.patient.create({
      data: {
        fullName: 'Paciente Concurrencia',
        rut: `${runId}${suffix}-1`,
        birthDate: new Date('1990-01-01T12:00:00.000Z'),
        therapistId,
      },
    });
    patientIds.push(patient.id);
    return patient;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    const therapist = await prisma.user.create({
      data: {
        email: `patient-update-concurrency-${runId}@example.com`,
        passwordHash: await argon2.hash('TestPass123!'),
        name: 'Dra. Concurrencia',
      },
    });
    therapistId = therapist.id;

    service = new PatientsService(
      prisma,
      new AuditService(prisma),
      {
        deletePatientEvents: () => Promise.resolve(),
      } as unknown as CalendarSyncService,
      {
        cancelUnpaidForPatient: () => Promise.resolve(),
      } as unknown as PaymentsService,
      { invalidate: () => undefined } as unknown as AvailabilityService,
      buildTestClinicalCrypto(),
    );
  }, 30000);

  afterAll(async () => {
    await prisma.patientHistory.deleteMany({
      where: { patientId: { in: patientIds } },
    });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    await prisma.user.deleteMany({ where: { id: therapistId } });
    await prisma.onModuleDestroy();
  }, 30000);

  it('dos ediciones simultáneas quedan en secuencia: el historial de la segunda parte de lo que dejó la primera', async () => {
    for (let round = 0; round < 5; round++) {
      const patient = await createPatient(`a${round}`);

      await Promise.all([
        service.update(
          patient.id,
          { occupation: `Oficio ${round}`, reason: 'Edición concurrente A' },
          therapistId,
        ),
        service.update(
          patient.id,
          { phone: `+5691111${round}`, reason: 'Edición concurrente B' },
          therapistId,
        ),
      ]);

      const history = await prisma.patientHistory.findMany({
        where: { patientId: patient.id },
      });
      expect(history).toHaveLength(2);
      const byField = (field: string) =>
        history.find((h) => field in (h.diff as Record<string, unknown>))!;
      const occupation = byField('occupation');
      const phone = byField('phone');

      const phoneRanAfterOccupation =
        (phone.snapshot as Record<string, unknown>).occupation ===
        `Oficio ${round}`;
      const occupationRanAfterPhone =
        (occupation.snapshot as Record<string, unknown>).phone ===
        `+5691111${round}`;
      expect(phoneRanAfterOccupation || occupationRanAfterPhone).toBe(true);

      const final = await prisma.patient.findUniqueOrThrow({
        where: { id: patient.id },
      });
      expect(final.occupation).toBe(`Oficio ${round}`);
      expect(final.phone).toBe(`+5691111${round}`);
    }
  }, 60000);

  it('una edición que espera el lock de un softDelete responde 404 y no modifica al paciente eliminado', async () => {
    const patient = await createPatient('b');

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));

    // Simula softDelete en curso: tiene la fila tomada y ya marcó deletedAt,
    // pero todavía no hizo commit.
    const deleting = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Patient" WHERE id = ${patient.id} FOR UPDATE`;
        await tx.patient.update({
          where: { id: patient.id },
          data: { deletedAt: new Date() },
        });
        locked();
        await gate;
      },
      { timeout: 30000 },
    );
    await holding;

    // La lectura previa de update() no ve el borrado sin commitear.
    const updating = service.update(
      patient.id,
      {
        occupation: 'No debería guardarse',
        reason: 'Edición junto a un borrado',
      },
      therapistId,
    );
    const outcome = updating.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await deleting;

    const result = await outcome;
    expect('error' in result && result.error).toBeInstanceOf(NotFoundException);

    const after = await prisma.patient.findUniqueOrThrow({
      where: { id: patient.id },
    });
    expect(after.occupation).toBeNull();
    expect(
      await prisma.patientHistory.count({ where: { patientId: patient.id } }),
    ).toBe(0);
  }, 60000);
});
